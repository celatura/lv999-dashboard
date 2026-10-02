import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { adjustCreditsSchema } from '@/features/admin/api/types';
import { grantCredits, setBalance } from '@/features/credits/api/service';

export const runtime = 'nodejs';

/** 管理端写限流：30 次/分/管理员（防误操作刷写；复用 agent 限流器，scope='admin'） */
const ADMIN_WRITE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 调整某用户 Credits：body `{ mode:'grant'|'set', amount:int, note? }`（Zod 校验）。
 * grant → 复用 grantCredits（余额 += amount）；set → 复用 setBalance（余额 = amount）；两者均写流水。
 * 非管理员 403。
 */
export async function POST(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  if (!isAdmin(userId)) {
    return apiError(403, 'forbidden', 'Forbidden');
  }

  const { id } = await context.params;
  if (!id) {
    return apiError(400, 'invalid_request', 'Missing user id');
  }

  // 限流与读 body 并行；按「限流 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('admin', userId, ADMIN_WRITE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = adjustCreditsSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid credits adjustment');
  }

  const { mode, amount, note } = parsed.data;
  const balance =
    mode === 'grant'
      ? await grantCredits({ userId: id, amount, note })
      : await setBalance({ userId: id, amount, note });

  return Response.json({ balance });
}
