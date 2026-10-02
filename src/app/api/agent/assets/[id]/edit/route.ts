import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { GenerationError } from '@/features/agent/api/generation-error';
import { ImageEditError, editImageAssetCore } from '@/features/agent/api/image-edit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { editImageRequestSchema } from '@/features/agent/api/types';
import { checkBalance } from '@/features/credits/api/service';
import { chargeOnGenerationResult } from '@/features/credits/lib/billing';
import { priceImage } from '@/features/credits/lib/pricing';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';

export const runtime = 'nodejs';
// I2I 同步生成实测 13-45s（上限 180s 超时），与 chat 路由同档
export const maxDuration = 300;

/** 图片编辑限流：I2I 是付费模型调用（≈0.20 元/次），20 次/分/用户 */
const IMAGE_EDIT_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 图片资产「继续修改」（直连 I2I，不经聊天）：
 * 对源图片资产按指令生成派生资产（sourceAssetId 记录血缘），返回新资产 id。
 * 核心流程与聊天内 editImageAsset 工具复用（features/agent/api/image-edit.ts）。
 */
export async function POST(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  // 限流与读 body 并行；按「限流 → 体积 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('image-edit', userId, IMAGE_EDIT_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
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

  const parsed = editImageRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'instruction is required (1..2000 chars)');
  }
  const { instruction, aspect } = parsed.data;
  // schema 校验的是原始串；trim 后再次校验，拦截纯空白指令
  const trimmedInstruction = instruction.trim();
  if (trimmedInstruction.length === 0 || trimmedInstruction.length > 2000) {
    return apiError(400, 'invalid_request', 'instruction is required (1..2000 chars)');
  }

  // 计费入口拦截：余额 ≤0 直接 402（不发起上游调用）
  if (!(await checkBalance(userId))) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  try {
    // 发起后按结果扣（I2I 与 T2I 同价）：源图预检失败（ImageEditError，未发起上游）不扣；
    // abort/超时/下载失败（billable）照扣；成功按张扣费
    const asset = await chargeOnGenerationResult({
      userId,
      kind: 'image',
      fallbackCharge: { cost: priceImage(true), meta: { edit: true, sourceAssetId: id } },
      run: () =>
        editImageAssetCore({
          userId,
          sourceAssetId: id,
          instruction: trimmedInstruction,
          aspect
        }),
      buildCharge: (created) => ({
        cost: priceImage(true),
        meta: { assetId: created.id, edit: true, sourceAssetId: id }
      })
    });
    return Response.json({ id: asset.id });
  } catch (error) {
    if (error instanceof ImageEditError) {
      if (error.code === 'source_too_large') {
        return apiError(413, 'payload_too_large', 'Source image exceeds 10MB edit limit');
      }
      return apiError(404, 'not_found', 'Source image asset not found');
    }
    if (error instanceof GenerationError) {
      // 生成失败原因（审核拒绝/限流/鉴权/超时）已由 image-generation.ts 映射为用户可读中文，
      // 以 generation_failed 透传（见 lib/api-error.ts 约定），与 T2I 直连端点一致
      console.error('[agent] direct image edit failed', { assetId: id, error: error.message });
      return apiError(502, 'generation_failed', error.message);
    }
    // 转存/落库等本地故障（非 billable，不扣费）
    console.error('[agent] direct image edit failed', { assetId: id, error });
    return apiError(502, 'invalid_request', 'Image generation failed');
  }
}
