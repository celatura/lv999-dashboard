import { experimental_generateVideo as generateVideo } from 'ai';
import {
  DEFAULT_VIDEO_MODEL,
  resolveVideoModel as resolveVideoModelEntry,
  resolveVideoResolution,
  type VideoAspectKey,
  type VideoResolutionTier
} from '../constants/video-models';
import { resolveVideoModel } from './provider';
import { errorHaystack, GenerationError } from './generation-error';
import { detectModelUnavailable } from './model-availability';

/**
 * 视频生成通道（server-only）：复用 AI SDK v7 的 experimental_generateVideo +
 * @ai-sdk/alibaba 的 videoModel()，provider 内部完成「提交异步任务 → 轮询状态 → 下载视频字节」全流程
 * （对比图片模块 image-generation.ts 的手写轮询，视频模块代码量少约 60%）。
 *
 * 关键点：
 * - 轮询由 SDK 内部完成（poll.intervalMs / timeoutMs）；timeoutMs 略小于 Route Handler maxDuration=300，
 *   留余量给 OSS 转存与落库。
 * - abortSignal 透传：用户停止时同步取消轮询与下载（已提交的百炼任务自然完成，无副作用，与图片一致）。
 * - 临时 video_url 由 SDK 内部下载，不外泄（红线：任何持久化字段不得存临时 URL，必须转存 OSS）。
 * - maxRetries: 0：视频成本高，不自动重试；失败由用户显式重试。
 * - I2V：wan3.0-video 为统一模型，prompt 传 { image: 首帧签名URL, text } 即走图生视频。
 */

/** 下载后视频体积上限（红线：>100MB 拒绝入库） */
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

/** MVP 时长硬上限（秒）：配合 720P 保证在 maxDuration=300 内完成 */
export const MAX_VIDEO_DURATION_MVP = 10;

/** MVP 时长下限（秒）：百炼视频模型最小 2s */
const MIN_VIDEO_DURATION = 2;

/** 轮询间隔与总时长上限（略小于 Route Handler maxDuration=300，留 20s 给转存与落库） */
export const VIDEO_POLL_INTERVAL_MS = 5_000;
export const VIDEO_POLL_TIMEOUT_MS = 280_000;

/** 视频限流：5 次/分/用户（视频成本 ≈0.5-1 元/次，比图片严） */
export const VIDEO_RATE_LIMIT = 5;
export const VIDEO_RATE_WINDOW_SECONDS = 60;

/** MP4 ftyp box 位于字节 4..8（下载内容校验，仿图片模块的 PNG 魔数校验） */
const MP4_FTYP = 'ftyp';

/** 用户停止 / SDK 中止判定 */
function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * 视频生成错误映射为用户可读中文（仿图片模块 toUserFacingError；详情走日志）。
 * billable 判据（见 docs/credits.md §7，百炼「失败不计费、仅对成功生成计费」）：
 * - abort / 轮询超时 / 下载失败（上游状态未知或已生成）→ billable=true（保守照扣）
 * - 审核拒绝 / 限流 / 鉴权 / 参数 / 其余上游明确失败 → billable=false（不扣）
 */
function toUserFacingVideoError(error: unknown, signal: AbortSignal | undefined): GenerationError {
  // 用户停止优先（区别于服务端超时/失败）：任务已提交、上游可能已 SUCCEEDED 计费 → 照扣
  if (signal?.aborted || isAbortError(error)) {
    return new GenerationError('视频生成已停止。', { cause: error, billable: true });
  }

  // 模型已下线 / 未开通 / 不存在优先判定（百炼 403 access_denied 文案不含「已下线」，
  // 落到下方的鉴权分支会误查 API Key）；上游明确失败 → 不扣
  const unavailable = detectModelUnavailable({ channel: 'video', error });
  if (unavailable) {
    return new GenerationError(unavailable, { cause: error, billable: false });
  }

  const haystack = errorHaystack(error);
  console.error('[agent] video generation failed', {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : String(error)
  });

  if (/DataInspectionFailed|IPInfringement|inappropriate|greennet|risk/i.test(haystack)) {
    // 内容审核拒绝是 400 失败，百炼不计费 → 不扣（纠正原「照扣」假设）
    return new GenerationError('内容审核未通过，请调整画面描述后重试。', {
      cause: error,
      billable: false
    });
  }
  if (/Throttling|RateLimit|LimitRequest|requests? per/i.test(haystack)) {
    return new GenerationError('视频生成繁忙（触发限流），请稍后再试。', {
      cause: error,
      billable: false
    });
  }
  if (/InvalidApiKey|AccessDenied|Unauthorized|Arrearage|Forbidden/i.test(haystack)) {
    return new GenerationError('视频服务鉴权失败或账户欠费，请检查 API Key 配置。', {
      cause: error,
      billable: false
    });
  }
  if (/InvalidParameter|InvalidVideo|resolution|duration/i.test(haystack)) {
    return new GenerationError('视频参数错误：请调整时长或分辨率后重试。', {
      cause: error,
      billable: false
    });
  }
  if (/timeout|timed out|TimeoutError|poll/i.test(haystack)) {
    // 轮询超时：任务已提交、上游可能已完成计费 → 保守照扣
    return new GenerationError(
      `视频生成超时（超过 ${Math.round(VIDEO_POLL_TIMEOUT_MS / 1000)} 秒），请稍后重试或缩短时长。`,
      { cause: error, billable: true }
    );
  }
  if (/NoVideoGenerated|download|network|fetch failed|ECONN/i.test(haystack)) {
    // 已生成后下载/转存失败（上游状态未知或已计费）→ 保守照扣
    return new GenerationError('视频下载失败，请稍后重试。', { cause: error, billable: true });
  }
  // 其余上游明确返回的失败 → 不扣
  return new GenerationError('视频生成失败，请稍后重试。', { cause: error, billable: false });
}

/**
 * 生成一段视频并返回其字节内容（内部完成「提交任务 → 轮询 → 下载 → 校验」）。
 * - T2V（默认）：prompt 为纯文本；
 * - I2V（传入 firstFrameUrl 时）：prompt = { image: 首帧公网URL, text }，wan3.0 统一模型原生支持。
 * 临时 video_url 由 SDK 内部下载，不外泄；体积超上限或格式非法则拒绝入库。
 */
export async function generateVideoAsset(params: {
  prompt: string;
  /** 模型 key（默认 wan3.0-video，统一 T2V + I2V） */
  modelKey?: string;
  /** 宽高比（默认 16:9） */
  aspect?: VideoAspectKey;
  /** 时长（秒，2..MAX_VIDEO_DURATION_MVP，默认 5） */
  duration?: number;
  /** 分辨率档（默认 720P） */
  resolution?: VideoResolutionTier;
  /** I2V：源图签名 URL（公网可达，作首帧） */
  firstFrameUrl?: string;
  /** 工具执行透传的 abortSignal（execute 第二参数），保证「停止」语义 */
  signal?: AbortSignal;
}): Promise<{
  videoBuffer: Buffer;
  mime: 'video/mp4';
  /** 实际生效的分辨率档（供计费；= 入参或默认 720P） */
  resolution: VideoResolutionTier;
  /** 实际生效的时长（秒，经钳制；供计费） */
  duration: number;
}> {
  const entry = resolveVideoModelEntry(params.modelKey ?? DEFAULT_VIDEO_MODEL);
  const model = resolveVideoModel(entry.providerModelId);

  const aspect = params.aspect ?? '16:9';
  const tier = params.resolution ?? '720P';
  const duration = Math.max(
    MIN_VIDEO_DURATION,
    Math.min(params.duration ?? 5, MAX_VIDEO_DURATION_MVP, entry.maxDuration)
  );
  // 顶层 resolution 需为像素格式（provider 内部映射回 720P/1080P 档）；
  // adaptive 比例或该档无对应尺寸时省略，仅由 aspectRatio 驱动
  const resolution = resolveVideoResolution(tier, aspect);

  let result;
  try {
    result = await generateVideo({
      model,
      prompt: params.firstFrameUrl
        ? { image: params.firstFrameUrl, text: params.prompt } // I2V（首帧 + 文本）
        : params.prompt, // T2V（纯文本）
      aspectRatio: aspect,
      ...(resolution ? { resolution } : {}),
      duration,
      providerOptions: {
        alibaba: {
          promptExtend: true, // 智能改写（短 prompt 效果提升明显）
          watermark: false,
          audio: entry.supportsAudio // wan3.0 原生音画同步
        }
      },
      poll: { intervalMs: VIDEO_POLL_INTERVAL_MS, timeoutMs: VIDEO_POLL_TIMEOUT_MS },
      abortSignal: params.signal,
      maxRetries: 0 // 视频成本高，不自动重试
    });
  } catch (error) {
    throw toUserFacingVideoError(error, params.signal);
  }

  const video = result.video;
  const videoBuffer = Buffer.from(video.uint8Array);
  if (videoBuffer.byteLength > MAX_VIDEO_SIZE_BYTES) {
    console.error('[agent] video exceeds size limit', { bytes: videoBuffer.byteLength });
    // 视频已上游成功生成 → 照扣
    throw new GenerationError('视频体积超过 100MB 上限，已拒绝入库。', { billable: true });
  }
  // MP4 ftyp box 校验：拦截下载到的非视频内容（错误页/空响应）
  if (videoBuffer.byteLength < 12 || videoBuffer.toString('ascii', 4, 8) !== MP4_FTYP) {
    console.error('[agent] downloaded video is not MP4', {
      headHex: videoBuffer.subarray(0, 12).toString('hex')
    });
    // 已生成后下载内容非法（上游已计费）→ 照扣
    throw new GenerationError('视频下载失败：返回内容不是有效的 MP4。', { billable: true });
  }
  return { videoBuffer, mime: 'video/mp4', resolution: tier, duration };
}
