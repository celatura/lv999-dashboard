import { getUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { getCreditAccount } from '@/features/credits/api/service';

export const runtime = 'nodejs';

/**
 * GET 当前用户 Credits 余额（供账号下拉菜单 / 流水页头部）。
 * 无账户行视为 0（懒创建，见 docs/credits.md）。发放通过管理端或 CLI，扣费在各计费入口内部完成。
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  return Response.json(await getCreditAccount(userId));
}
