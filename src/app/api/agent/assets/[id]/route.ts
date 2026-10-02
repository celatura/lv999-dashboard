import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { deleteAsset, getAsset, updateDesignAsset } from '@/features/agent/api/service';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { updateDesignRequestSchema } from '@/features/design/api/types';
import { decodePreviewPng } from '@/features/design/lib/preview-png';
import { getSignedUrl } from '@/lib/oss';

export const runtime = 'nodejs';

/** design 写入限流：与 POST 同 scope，30 次/分/用户 */
const DESIGN_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  const asset = await getAsset(userId, id);
  if (!asset) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  // 二进制资产（storageKey 存在：image / design 预览 PNG）附签发预览 URL（3600s），
  // 客户端 <img> 直连 OSS；每次查询重新签发
  const previewUrl = asset.storageKey ? await getSignedUrl(asset.storageKey, 3600) : null;
  return Response.json({ ...asset, previewUrl });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  const deleted = await deleteAsset(userId, id);
  if (!deleted) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  return Response.json({ success: true });
}

/** 更新 design 资产：文档 JSON / 标题 / 预览 PNG（按所有权，仅限 kind='design'） */
export async function PATCH(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('design', userId, DESIGN_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
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

  const parsed = updateDesignRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid design document');
  }
  const { title, document, previewPng } = parsed.data;

  // 归属 + 类型校验：目标必须是当前用户的 design 资产
  const existing = await getAsset(userId, id);
  if (!existing || existing.kind !== 'design') {
    return apiError(404, 'not_found', 'Asset not found');
  }

  let previewBuffer: Buffer | null = null;
  if (previewPng) {
    try {
      previewBuffer = decodePreviewPng(previewPng);
    } catch {
      return apiError(400, 'invalid_request', 'Invalid preview image');
    }
  }

  const updated = await updateDesignAsset({
    userId,
    assetId: id,
    ...(title !== undefined && { title: title.trim() || '未命名设计' }),
    ...(document !== undefined && { document: JSON.stringify(document) }),
    previewPng: previewBuffer
  });
  if (!updated) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  return Response.json({ success: true });
}
