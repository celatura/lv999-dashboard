import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { deleteUserCascade } from '@/features/admin/api/service';

export const runtime = 'nodejs';
/** 删除为长操作（删 Better Auth 用户 + 7 表事务 + 逐个 OSS 删除），留足超时余量 */
export const maxDuration = 60;

/** 管理端写限流：30 次/分/管理员（防误操作；复用 agent 限流器，scope='admin'） */
const ADMIN_WRITE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 级联删除用户（不可逆）：删 Better Auth 用户断登录 → DB 事务清 7 表 → OSS 对象清理。
 * 非管理员 403；禁止管理员删除自己（防自删锁死，删后会立即断登录并失去管理入口）。
 */
export async function DELETE(_request: Request, context: RouteContext) {
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
  if (id === userId) {
    return apiError(400, 'invalid_request', 'Cannot delete your own account');
  }

  const allowed = await checkRateLimit(
    'admin',
    userId,
    ADMIN_WRITE_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  const result = await deleteUserCascade(id);
  return Response.json(result);
}
