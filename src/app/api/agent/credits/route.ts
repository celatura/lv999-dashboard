import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { getBalance } from '@/features/credits/api/service';

export const runtime = 'nodejs';

/**
 * GET 当前用户 Credits 余额（供账号下拉菜单 / 流水页头部）。
 * 无账户行视为 0（懒创建，见 docs/credits.md §2）。无写端点：grant 仅 CLI，扣费在各计费入口内部完成。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const balance = await getBalance(userId);
  return Response.json({ balance });
}
