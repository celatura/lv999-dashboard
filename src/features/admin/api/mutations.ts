import { mutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import { creditKeys } from '@/features/credits/api/queries';
import { adminKeys } from './queries';
import type { AdjustCreditsRequest, AdjustCreditsResult, DeleteUserResult } from './types';

/**
 * 调 Credits / 删用户（管理员写操作）。
 * 均在服务端 `/api/admin/*` 完成 isAdmin 校验与业务处理，客户端仅触发 + 失效缓存。
 *
 * 失效统一放 onSettled：失败时服务端也可能已部分生效；组件覆盖 onSuccess 也不会丢掉失效。
 */

/** 调 Credits 影响：admin 用户列表余额列 + 当前登录者自身的 credits 缓存（若调的是自己）→ 两域都失效 */
function invalidateAfterCreditsChange(): void {
  void getQueryClient().invalidateQueries({ queryKey: adminKeys.usersRoot() });
  void getQueryClient().invalidateQueries({ queryKey: creditKeys.all });
}

export const adjustCreditsMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: AdjustCreditsRequest }) =>
    apiClient<AdjustCreditsResult>(`/admin/users/${id}/credits`, {
      method: 'POST',
      body: JSON.stringify(values)
    }),
  onSettled: invalidateAfterCreditsChange
});

/** 删除用户：结束后失效列表（余额合并随之刷新） */
export const deleteUserMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<DeleteUserResult>(`/admin/users/${id}`, { method: 'DELETE' }),
  onSettled: () => {
    void getQueryClient().invalidateQueries({ queryKey: adminKeys.usersRoot() });
  }
});
