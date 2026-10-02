import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { GenerationError } from '@/features/agent/api/generation-error';
import { generateImage } from '@/features/agent/api/image-generation';
import { createImageAsset } from '@/features/agent/api/service';
import { generateImageRequestSchema } from '@/features/agent/api/types';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { ASPECT_PRESETS } from '@/features/agent/constants/image-models';
import { checkBalance } from '@/features/credits/api/service';
import { chargeOnGenerationResult } from '@/features/credits/lib/billing';
import { priceImage } from '@/features/credits/lib/pricing';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';

export const runtime = 'nodejs';
// T2I 同步生成实测 10-60s（上游同步超时 180s），与 I2I 直连编辑同档
export const maxDuration = 300;

/** 生图限流：T2I 是付费模型调用（≈0.18 元/张），20 次/分/用户（与 image-edit 同档） */
const IMAGE_GENERATE_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/** 缺省资产标题：prompt 压平空白后截断（title 上限 100，展示以短为宜） */
const FALLBACK_TITLE_MAX_LENGTH = 60;

function buildAssetTitle(prompt: string, title?: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 100);
  const flat = prompt.replace(/\s+/g, ' ').trim();
  if (!flat) return 'AI 生成图片';
  return flat.length > FALLBACK_TITLE_MAX_LENGTH
    ? `${flat.slice(0, FALLBACK_TITLE_MAX_LENGTH)}…`
    : flat;
}

/**
 * 图片「AI 生成」（直连 T2I，不经聊天）：按 prompt + 可选比例生成图片资产，返回新资产 id。
 * 供设计画布「AI 生成图片」调用；核心流程与聊天内 createImageAsset 工具同源
 * （generateImage + createImageAsset），资产 source='agent'、conversationId=null、content=prompt，
 * 可在「我的资产」复用。计费/限流/402 拦截与 `/assets/[id]/edit`（I2I）同构。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 限流与读 body 并行；按「限流 → 体积 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('image-generate', userId, IMAGE_GENERATE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    return apiError(413, 'payload_too_large', 'Request body too large');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = generateImageRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'prompt is required (1..2000 chars)');
  }
  const { prompt, aspect, title } = parsed.data;
  // schema 校验的是原始串；trim 后再次校验，拦截纯空白 prompt
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0 || trimmedPrompt.length > 2000) {
    return apiError(400, 'invalid_request', 'prompt is required (1..2000 chars)');
  }

  // 计费入口拦截：余额 ≤0 直接 402（不发起上游调用）
  if (!(await checkBalance(userId))) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  try {
    // 发起后按结果扣（T2I 档）：审核拒绝/鉴权/参数/限流（billable=false）不扣；
    // abort/超时/已生成后下载失败（billable=true）照扣；成功按张扣费
    const asset = await chargeOnGenerationResult({
      userId,
      kind: 'image',
      fallbackCharge: { cost: priceImage(false), meta: { edit: false } },
      run: async () => {
        const { imageBuffer, mime } = await generateImage({
          prompt: trimmedPrompt,
          size: aspect ? ASPECT_PRESETS[aspect] : undefined
        });
        return createImageAsset({
          userId,
          conversationId: null,
          title: buildAssetTitle(trimmedPrompt, title),
          prompt: trimmedPrompt,
          imageBuffer,
          mime
        });
      },
      buildCharge: (created) => ({
        cost: priceImage(false),
        meta: { assetId: created.id, edit: false }
      })
    });
    return Response.json({ id: asset.id });
  } catch (error) {
    if (error instanceof GenerationError) {
      // 生成失败原因（审核拒绝/限流/鉴权/超时）已由 image-generation.ts 映射为用户可读中文，
      // 以 generation_failed 透传（见 lib/api-error.ts 约定），前端原样展示
      console.error('[agent] direct image generate failed', { error: error.message });
      return apiError(502, 'generation_failed', error.message);
    }
    // 转存/落库等本地故障（非 billable，不扣费）
    console.error('[agent] direct image generate failed', { error });
    return apiError(502, 'invalid_request', 'Image generation failed');
  }
}
