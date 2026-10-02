import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { setAssetFavorite } from '@/features/agent/api/service';
import { favoriteRequestSchema } from '@/features/agent/api/types';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';

export const runtime = 'nodejs';

/** 收藏切换限流：轻量 DB 写，60 次/分/用户 */
const FAVORITE_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/** 收藏/取消收藏资产（任意 kind，按所有权） */
export async function POST(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('favorite', userId, FAVORITE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
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

  const parsed = favoriteRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'favorite (boolean) is required');
  }

  const updated = await setAssetFavorite(userId, id, parsed.data.favorite);
  if (!updated) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  return Response.json({ success: true, favorite: parsed.data.favorite });
}
