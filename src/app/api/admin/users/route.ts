import { requireUserIdAuthoritative } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isAdmin } from '@/lib/admin';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { listUsers } from '@/features/admin/api/service';
import type { AdminUserFilters } from '@/features/admin/api/types';

export const runtime = 'nodejs';

/** 管理端读限流：60 次/分/管理员（分页/搜索较频繁，留足余量；复用 agent 限流器，scope='admin' 独立命名空间） */
const ADMIN_READ_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 管理员用户列表：Better Auth user 表（分页 + query 搜索 + 排序）+ 合并 Credits 余额。非管理员 403。 */
export async function GET(request: Request) {
  const userId = await requireUserIdAuthoritative();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  if (!isAdmin(userId)) {
    return apiError(403, 'forbidden', 'Forbidden');
  }

  const allowed = await checkRateLimit(
    'admin',
    userId,
    ADMIN_READ_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  const { searchParams } = new URL(request.url);
  const filters: AdminUserFilters = {
    page: parseInteger(searchParams.get('page')),
    limit: parseInteger(searchParams.get('limit')),
    query: searchParams.get('query') ?? undefined,
    sort: searchParams.get('sort') ?? undefined
  };

  const result = await listUsers(filters);
  return Response.json(result);
}
