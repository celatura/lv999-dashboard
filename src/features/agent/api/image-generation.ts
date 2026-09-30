import {
  DEFAULT_IMAGE_MODEL,
  resolveImageModel,
  type ImageModelRegistryEntry
} from '../constants/image-models';
import { GenerationError } from './generation-error';
import { detectModelUnavailable } from './model-availability';

/**
 * 图片生成通道（server-only）：直连百炼 REST API，不引入任何新依赖（fetch + Buffer 已足够）。
 *
 * 不使用 AI SDK provider——@ai-sdk/alibaba 无图像模型（Phase 3 视频可复用其 video 模型）。
 * 端点为经典域名 dashscope.aliyuncs.com（M0 实测可用；官方新式工作空间子域名亦可，暂不迁移）。
 *
 * 本模块内完成「调用 → 拿临时 URL → 立即下载」，临时 URL（24h 有效）不外泄（红线：
 * 任何持久化字段不得存临时 URL，必须转存 OSS）。
 */

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com';

/** 异步任务轮询间隔与总时长上限（决策 4：间隔 3s、上限 120s） */
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;

/** 各阶段请求超时 */
const CREATE_TASK_TIMEOUT_MS = 30_000;
const SYNC_GENERATE_TIMEOUT_MS = 180_000;
const QUERY_TASK_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 下载后图片体积上限（红线：>15MB 拒绝入库） */
const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function getApiKey(): string {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    // 配置错误（未发起上游调用）→ 不扣
    throw new GenerationError('图片生成服务未配置（缺少 DASHSCOPE_API_KEY）。', {
      billable: false
    });
  }
  return apiKey;
}

/** 外部 abortSignal（用户停止）与阶段超时合并；signal 为空时仅超时 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** 读取响应文本并尝试 JSON 解析；非 JSON（如网关 HTML 报错）时抛出含片段的错误 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error('[agent] image API returned non-JSON', {
      status: response.status,
      body: text.slice(0, 300)
    });
    // 网关非 JSON 报错（上游明确失败）→ 不扣
    throw new GenerationError(`图片生成失败（HTTP ${response.status}，非 JSON 响应）。`, {
      billable: false
    });
  }
}

/**
 * 百炼错误（顶层 code/message 或 output.code/message）映射为用户可读中文（详情走日志）。
 * 全部为「上游明确返回失败」→ billable=false（百炼失败不计费，见 docs/credits.md §7）。
 */
function toUserFacingError(
  body: Record<string, unknown>,
  httpStatus: number,
  context: string
): GenerationError {
  const output = body.output as Record<string, unknown> | undefined;
  const code = (body.code ?? output?.code) as string | undefined;
  const message = (body.message ?? output?.message) as string | undefined;

  // 模型已下线 / 未开通 / 不存在优先判定：百炼返回 403 access_denied 且文案不含「已下线」，
  // 若落到下面的鉴权分支会把排查引向 API Key（实际要改的是模型注册表）；上游明确失败 → 不扣
  const unavailable = detectModelUnavailable({
    channel: 'image',
    status: httpStatus,
    body,
    detail: { context, code }
  });
  if (unavailable) return new GenerationError(unavailable, { billable: false });

  console.error('[agent] image generation failed', { context, httpStatus, code, message });

  if (
    code === 'InvalidApiKey' ||
    code === 'AccessDenied' ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return new GenerationError('图片服务鉴权失败，请检查 API Key 配置。', { billable: false });
  }
  if (code === 'DataInspectionFailed' || code === 'IPInfringementSuspect') {
    // 内容审核拒绝是 400 失败，百炼不计费 → 不扣（纠正原「照扣」假设）
    return new GenerationError('内容审核未通过，请调整画面描述后重试。', { billable: false });
  }
  if (code === 'Throttling' || httpStatus === 429) {
    return new GenerationError('图片生成繁忙（触发限流），请稍后再试。', { billable: false });
  }
  if (code === 'InvalidParameter' || httpStatus === 400) {
    return new GenerationError(`图片生成参数错误：${message ?? '请调整描述后重试。'}`, {
      billable: false
    });
  }
  // 其余上游明确返回的失败（5xx / 任务 FAILED 等）→ 不扣
  return new GenerationError('图片生成失败，请稍后重试。', { billable: false });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetch 包装：停止 / 超时 / 网络错误映射为用户可读中文（详情走日志）。
 * 停止路径依赖外部 abortSignal（工具 execute 第二参数）的组合信号：
 * 用户停止 → AbortError；阶段超时 → TimeoutError（AbortSignal.timeout）。
 */
async function fetchImageApi(url: string, init: RequestInit, context: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // 用户停止：任务可能已提交、上游状态未知 → 保守照扣
      throw new GenerationError('图片生成已停止。', { cause: error, billable: true });
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.error('[agent] image api request timed out', { context });
      // 阶段超时：任务可能已提交并完成 → 保守照扣
      throw new GenerationError('图片生成请求超时，请稍后重试。', { cause: error, billable: true });
    }
    console.error('[agent] image api network error', {
      context,
      error: error instanceof Error ? error.message : error
    });
    // 提交前网络错误（未到达上游）→ 不扣
    throw new GenerationError('图片生成网络错误，请稍后重试。', { cause: error, billable: false });
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

/** 异步协议：创建任务 → 轮询任务状态（保留备用；3.0 系列同样支持异步接入，当前注册表未使用） */
async function generateViaAsyncTask(
  entry: ImageModelRegistryEntry,
  prompt: string,
  signal: AbortSignal | undefined
): Promise<string> {
  const createEndpoint = `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/text2image/image-synthesis`;
  const createResponse = await fetchImageApi(
    createEndpoint,
    {
      method: 'POST',
      headers: authHeaders({ 'X-DashScope-Async': 'enable' }),
      body: JSON.stringify({
        model: entry.providerModelId,
        input: { prompt },
        parameters: { n: 1, watermark: false }
      }),
      signal: withTimeout(signal, CREATE_TASK_TIMEOUT_MS)
    },
    'create-task'
  );
  const created = await readJson(createResponse);
  const createdOutput = created.output as Record<string, unknown> | undefined;
  const taskId = createdOutput?.task_id as string | undefined;
  if (!createResponse.ok || !taskId) {
    throw toUserFacingError(created, createResponse.status, 'create-task');
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 'PENDING';
  while (Date.now() < deadline) {
    // 停止联动：轮询循环每轮检查 abortSignal（已创建的百炼任务无法取消，会自然完成，无副作用）
    // 任务已提交、上游状态未知 → 保守照扣
    if (signal?.aborted) throw new GenerationError('图片生成已停止。', { billable: true });
    await sleep(POLL_INTERVAL_MS);
    const queried = await readJson(
      await fetchImageApi(
        `${DASHSCOPE_BASE_URL}/api/v1/tasks/${taskId}`,
        {
          headers: authHeaders(),
          signal: withTimeout(signal, QUERY_TASK_TIMEOUT_MS)
        },
        'query-task'
      )
    );
    const queriedOutput = queried.output as Record<string, unknown> | undefined;
    lastStatus = String(queriedOutput?.task_status ?? 'UNKNOWN');
    if (lastStatus === 'SUCCEEDED') {
      const results = queriedOutput?.results as { url?: string }[] | undefined;
      const url = results?.[0]?.url;
      if (!url) {
        console.error('[agent] image task succeeded but no url returned');
        // 任务已成功（上游已计费）但未返回图片 → 照扣
        throw new GenerationError('图片生成失败：任务成功但未返回图片。', { billable: true });
      }
      return url;
    }
    if (lastStatus === 'FAILED' || lastStatus === 'CANCELED' || lastStatus === 'UNKNOWN') {
      throw toUserFacingError(queried, 200, `task-${lastStatus}`);
    }
  }
  console.error('[agent] image task polling timed out', { timeoutMs: POLL_TIMEOUT_MS, lastStatus });
  // 轮询超时：任务已提交、上游可能已完成计费 → 保守照扣
  throw new GenerationError(`图片生成超时（超过 ${POLL_TIMEOUT_MS / 1000} 秒），请稍后重试。`, {
    billable: true
  });
}

/** 同步协议：一次请求等待结果（3.0 系列；T2I 与 I2I 共用此路径） */
async function generateViaSync(
  entry: ImageModelRegistryEntry,
  content: { text?: string; image?: string }[],
  size: string | undefined,
  signal: AbortSignal | undefined
): Promise<string> {
  const endpoint = `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await fetchImageApi(
    endpoint,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: entry.providerModelId,
        input: { messages: [{ role: 'user', content }] },
        parameters: {
          // n 显式设置：3.0 系列默认即为 1，显式传入防止未来模型默认多图计费
          n: 1,
          watermark: false,
          negative_prompt: '',
          // 3.0 系列 enable_thinking 默认开启，生成耗时会增加 3-4 倍（实测 3.0-pro 137s vs 35s），
          // 交互式生成必须显式关闭
          enable_thinking: false,
          // 不传 size 时由模型自动推荐分辨率（T2I/I2I 同规则）
          ...(size ? { size } : {})
        }
      }),
      signal: withTimeout(signal, SYNC_GENERATE_TIMEOUT_MS)
    },
    'sync-generate'
  );
  const body = await readJson(response);
  if (!response.ok || body.code) {
    throw toUserFacingError(body, response.status, 'sync-generate');
  }
  const output = body.output as
    | { choices?: { message?: { content?: { image?: string }[] } }[] }
    | undefined;
  const url = output?.choices?.[0]?.message?.content?.[0]?.image;
  if (!url) {
    console.error('[agent] sync image response has no image url');
    // 响应 200 但未包含图片（上游未交付可用结果）→ 不扣
    throw new GenerationError('图片生成失败：响应中未包含图片。', { billable: false });
  }
  return url;
}

/**
 * 下载临时图 → 校验 PNG 魔数与体积上限 → 返回 Buffer（临时 URL 到此为止，不外泄）。
 * 网络抖动重试 1 次（实测偶发 Unable to connect）；用户停止 / 超时不重试。
 * 图片此时已上游成功生成（已拿到临时 URL）→ 本函数所有失败均为「已生成后下载失败」→ billable=true。
 */
async function downloadImage(url: string, signal: AbortSignal | undefined): Promise<Buffer> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2 && !response; attempt += 1) {
    try {
      response = await fetch(url, { signal: withTimeout(signal, DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) {
        throw new GenerationError('图片生成已停止。', { cause: error, billable: true });
      }
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        console.error('[agent] image download timed out', { attempt });
        throw new GenerationError('图片下载超时，请稍后重试。', { cause: error, billable: true });
      }
      console.warn('[agent] image download attempt failed', {
        attempt,
        error: error instanceof Error ? error.message : error
      });
    }
  }
  if (!response) {
    console.error('[agent] image download failed after retries');
    throw new GenerationError('图片下载网络错误，请稍后重试。', {
      cause: lastError,
      billable: true
    });
  }
  if (!response.ok) {
    console.error('[agent] image download failed', { status: response.status });
    throw new GenerationError('图片下载失败，请稍后重试。', { billable: true });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    console.error('[agent] downloaded image is not PNG', {
      headHex: buffer.subarray(0, 8).toString('hex')
    });
    throw new GenerationError('图片下载失败：返回内容不是 PNG。', { billable: true });
  }
  if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
    console.error('[agent] image exceeds size limit', { bytes: buffer.byteLength });
    throw new GenerationError('图片体积超过 15MB 上限，已拒绝入库。', { billable: true });
  }
  return buffer;
}

/**
 * 生成/编辑一张图片并返回其字节内容（MVP 单默认模型，不做选择器）。
 * - T2I（默认）：content 仅 text；
 * - I2I（传入 referenceImageUrl 时）：content = [{ image }, { text }]（3.0 系列原生支持，
 *   源图为公网可达 URL，当前传入 OSS 短期签名 URL；I2I 输入上限 10MB，由调用方预检）。
 * 内部完成「调用 → 拿临时 URL → 立即下载」；超时上限 120s（轮询）/180s（同步）。
 */
export async function generateImage(params: {
  prompt: string;
  /** 可选：I2I 参考图（公网 URL）；传入时走图生图/图像编辑 */
  referenceImageUrl?: string;
  /** 可选：输出尺寸 "宽*高"（见 ASPECT_PRESETS）；缺省由模型自动推荐 */
  size?: string;
  /** 工具执行透传的 abortSignal（execute 第二参数），保证「停止」语义 */
  signal?: AbortSignal;
}): Promise<{ imageBuffer: Buffer; mime: 'image/png' }> {
  const entry = resolveImageModel(DEFAULT_IMAGE_MODEL);
  if (entry.protocol === 'async-task') {
    if (params.referenceImageUrl) {
      // 参数/能力不匹配（未发起上游调用）→ 不扣
      throw new GenerationError('当前图片模型不支持图像编辑。', { billable: false });
    }
    const temporaryUrl = await generateViaAsyncTask(entry, params.prompt, params.signal);
    const imageBuffer = await downloadImage(temporaryUrl, params.signal);
    return { imageBuffer, mime: 'image/png' };
  }
  const content = params.referenceImageUrl
    ? [{ image: params.referenceImageUrl }, { text: params.prompt }]
    : [{ text: params.prompt }];
  const temporaryUrl = await generateViaSync(entry, content, params.size, params.signal);
  const imageBuffer = await downloadImage(temporaryUrl, params.signal);
  return { imageBuffer, mime: 'image/png' };
}
