/* oxlint-disable no-console */
/**
 * 百炼模型可用性自查：逐个实调注册表里的全部 model ID，识别「已下线 / 未开通 / 不存在」。
 *
 * 为什么要这个脚本：百炼按迭代不定期下线老旧模型（主线模型提前 3 个月通知、日期快照仅提前
 * 30 天），且调用已下线模型返回 403 + `access_denied` —— 报错文案不含「已下线」字样，
 * 只看日志极易误判成 API Key 问题。下线名单与机制：
 * https://help.aliyun.com/zh/model-studio/model-depreciation
 *
 * 运行（Bun 自动加载 .env.local 的 DASHSCOPE_API_KEY）：
 *   bun run scripts/model-audit.ts             便宜通道：4 个对话 + 1 个 embedding（合计约几分钱）
 *   bun run scripts/model-audit.ts --image     追加 2 个图片模型（≈0.18 元/张 + 0.5 元/张，各 25-35s）
 *   bun run scripts/model-audit.ts --video     追加 2 个视频模型（480P×2s ≈0.6 元/条，各 1-3 分钟）
 *   bun run scripts/model-audit.ts --all       全通道
 *
 * 边界：只做最小化上游调用，不写 DB、不落 OSS（图片返回的临时 URL 直接丢弃，符合
 * 「任何持久化字段不得存临时 URL」红线）。
 * 建议节奏：收到下线公告后立刻跑一次，下线日前一周再跑一次；退出码非 0 即有模型不可用。
 */
import { embed, generateText } from 'ai';
import { resolveEmbeddingModel, resolveModel } from '../src/features/agent/api/provider';
import { detectModelUnavailable } from '../src/features/agent/api/model-availability';
import { generateVideoAsset } from '../src/features/agent/api/video-generation';
import { EMBEDDING_DIM, EMBEDDING_MODEL } from '../src/features/agent/constants/embedding';
import {
  IMAGE_MODEL_KEYS,
  IMAGE_MODEL_REGISTRY
} from '../src/features/agent/constants/image-models';
import {
  MODEL_KEYS,
  MODEL_REGISTRY,
  MODEL_UNAVAILABLE_MESSAGES
} from '../src/features/agent/constants/models';
import {
  VIDEO_MODEL_KEYS,
  VIDEO_MODEL_REGISTRY
} from '../src/features/agent/constants/video-models';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com';

const flags = new Set(process.argv.slice(2));
const withImage = flags.has('--image') || flags.has('--all');
const withVideo = flags.has('--video') || flags.has('--all');

if (!process.env.DASHSCOPE_API_KEY) {
  console.error('缺少 DASHSCOPE_API_KEY：请在 .env.local 配置百炼 API Key 后重试。');
  process.exit(1);
}

const unavailables: string[] = [];
const failures: string[] = [];

function isKnownUnavailableMessage(message: string): boolean {
  return (MODEL_UNAVAILABLE_MESSAGES as readonly string[]).includes(message);
}

/**
 * 统一探针包装：计时 + 归类失败（模型不可用 / 其他错误）。
 * 归类走服务端同一套识别逻辑（api/model-availability.ts），保证脚本结论与线上提示一致。
 */
async function runProbe(
  channel: string,
  key: string,
  modelId: string,
  task: () => Promise<string>
): Promise<void> {
  const label = `${channel.padEnd(9)} ${key.padEnd(20)} ${modelId}`;
  const startedAt = Date.now();
  try {
    const note = await task();
    console.log(`[ok]          ${label}  ${Date.now() - startedAt}ms  ${note}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const mapped =
      detectModelUnavailable({ channel, error, detail: { key, modelId } }) ??
      (isKnownUnavailableMessage(detail) ? detail : null);
    if (mapped) {
      unavailables.push(`${channel}/${modelId}`);
      console.error(`[unavailable] ${label}  ${mapped}`);
    } else {
      failures.push(`${channel}/${modelId}`);
      console.error(`[fail]        ${label}  ${detail.slice(0, 200)}`);
    }
  }
}

/** 上游非 2xx / 带 code 的响应转成 Error（携带 statusCode，供可用性识别） */
function upstreamError(status: number, body: Record<string, unknown>): Error {
  const error = new Error(`HTTP ${status} ${JSON.stringify(body).slice(0, 200)}`) as Error & {
    statusCode?: number;
    code?: unknown;
  };
  error.statusCode = status;
  error.code = body.code;
  return error;
}

/** 对话通道：最小输出 + 不重试（思考型模型可能在 64 token 预算内只出 reasoning，调用不抛错即视为存活） */
async function probeChat(): Promise<void> {
  for (const key of MODEL_KEYS) {
    const { providerModelId } = MODEL_REGISTRY[key];
    await runProbe('chat', key, providerModelId, async () => {
      const { text } = await generateText({
        model: resolveModel(key),
        prompt: '只回复两个字：可用',
        maxOutputTokens: 64,
        maxRetries: 0
      });
      return text.length > 0
        ? `输出 ${text.length} 字`
        : '未出正文（思考预算占满，属正常；调用未报错即模型存活）';
    });
  }
}

/** embedding 通道：顺带校验维度（维度漂移意味着存量索引需重建，不只是模型换名） */
async function probeEmbedding(): Promise<void> {
  await runProbe('embedding', 'EMBEDDING_MODEL', EMBEDDING_MODEL, async () => {
    const { embedding } = await embed({
      model: resolveEmbeddingModel(),
      value: '模型可用性自查',
      providerOptions: { openaiCompatible: { dimensions: EMBEDDING_DIM } }
    });
    if (embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `维度漂移：返回 ${embedding.length}，期望 ${EMBEDDING_DIM}（knowledge_chunks.embedding 列与索引需重建）`
      );
    }
    return `${embedding.length} 维`;
  });
}

/** 图片通道：同步端点 + 最小尺寸（512*512 为官方允许的最小面积档），只验证能否出图 */
async function probeImage(): Promise<void> {
  for (const key of IMAGE_MODEL_KEYS) {
    const { providerModelId } = IMAGE_MODEL_REGISTRY[key];
    await runProbe('image', key, providerModelId, async () => {
      const response = await fetch(
        `${DASHSCOPE_BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: providerModelId,
            input: {
              messages: [{ role: 'user', content: [{ text: '一只白色猫咪坐在木桌上的简洁插画' }] }]
            },
            parameters: {
              n: 1,
              size: '512*512',
              watermark: false,
              negative_prompt: '',
              // 3.0 系列默认开启 thinking，耗时会增加 3-4 倍（与生产参数保持一致）
              enable_thinking: false
            }
          }),
          signal: AbortSignal.timeout(180_000)
        }
      );
      const text = await response.text();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // 非 JSON（网关 HTML 报错等）：与生产 readJson 同口径，归入「其他失败」而非模型不可用
        throw new Error(`HTTP ${response.status} 非 JSON 响应：${text.slice(0, 200)}`);
      }
      if (!response.ok || body.code) throw upstreamError(response.status, body);
      const output = body.output as
        | { choices?: { message?: { content?: { image?: string }[] } }[] }
        | undefined;
      if (!output?.choices?.[0]?.message?.content?.[0]?.image) {
        throw new Error('响应 200 但未包含图片 URL');
      }
      return '同步协议出图正常（临时 URL 已丢弃）';
    });
  }
}

/** 视频通道：480P × 2s（最省钱档），走生产同一函数 generateVideoAsset */
async function probeVideo(): Promise<void> {
  for (const key of VIDEO_MODEL_KEYS) {
    const { providerModelId } = VIDEO_MODEL_REGISTRY[key];
    await runProbe('video', key, providerModelId, async () => {
      const { videoBuffer } = await generateVideoAsset({
        prompt: '一只白色猫咪在草地上缓慢奔跑',
        modelKey: key,
        aspect: '1:1',
        resolution: '480P',
        duration: 2
      });
      return `${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)}MB`;
    });
  }
}

console.log('=== 百炼模型可用性自查 ===');
console.log(
  `通道：chat(${MODEL_KEYS.length}) + embedding(1)` +
    (withImage ? ` + image(${IMAGE_MODEL_KEYS.length})` : '') +
    (withVideo ? ` + video(${VIDEO_MODEL_KEYS.length})` : '')
);
console.log(
  '成本参考：对话/embedding 合计约几分钱；图片 0.18-0.5 元/张；视频 480P×2s ≈0.6 元/条\n'
);

await probeChat();
await probeEmbedding();
if (withImage) await probeImage();
if (withVideo) await probeVideo();

const skipped = [withImage ? null : '图片', withVideo ? null : '视频'].filter(
  (value): value is string => value !== null
);

console.log('\n=== 结论 ===');
if (unavailables.length > 0) {
  console.error(
    `模型不可用（已下线 / 未开通 / 不存在）：\n  - ${unavailables.join('\n  - ')}\n` +
      '处理：到百炼模型广场选替代模型 → 改对应注册表的 providerModelId' +
      '（constants/models.ts / image-models.ts / video-models.ts / embedding.ts）→ 重跑本脚本。\n' +
      '注意：对话模型内部 key 是落库值（conversations.model）与计费表 key，只改 providerModelId 无需迁移 DB。'
  );
}
if (failures.length > 0) {
  console.error(
    `其他失败（鉴权 / 限流 / 参数 / 网络，不一定是下线）：\n  - ${failures.join('\n  - ')}`
  );
}
if (unavailables.length === 0 && failures.length === 0) {
  console.log('全部已自查模型可用。');
}
if (skipped.length > 0) {
  console.log(
    `未自查：${skipped.join(' / ')}通道（成本原因默认跳过，加 --image / --video / --all 开启）。`
  );
}

process.exit(unavailables.length + failures.length > 0 ? 1 : 0);
