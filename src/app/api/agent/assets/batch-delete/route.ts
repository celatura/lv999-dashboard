import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { deleteAsset } from '@/features/agent/api/service';
import { batchDeleteRequestSchema } from '@/features/agent/api/types';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';

export const runtime = 'nodejs';

/** 批量删除限流：单次最多 100 个，10 次/分/用户已足够 */
const BATCH_DELETE_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * 批量删除资产：逐个走 deleteAsset（含所有权校验与 OSS 对象清理）。
 * 不存在的 id 静默跳过，返回实际删除计数；全部未命中时返回 404。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('batch-delete', userId, BATCH_DELETE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
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

  const parsed = batchDeleteRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'ids (1..100 uuid array) is required');
  }

  // 去重后并发删除：单次最多 100 个，各 id 互不依赖；deleteAsset 内部已兜底 OSS 失败，
  // 并发上限 10 即可避免瞬时打满 DB 连接池
  const ids = [...new Set(parsed.data.ids)];
  const DELETE_CONCURRENCY = 10;
  const results = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / DELETE_CONCURRENCY) }, (_, batch) =>
      Promise.all(
        ids
          .slice(batch * DELETE_CONCURRENCY, (batch + 1) * DELETE_CONCURRENCY)
          .map((id) => deleteAsset(userId, id))
      )
    )
  );
  const deleted = results.flat().filter(Boolean).length;
  if (deleted === 0) {
    return apiError(404, 'not_found', 'No matching assets found');
  }
  return Response.json({ success: true, deleted });
}
