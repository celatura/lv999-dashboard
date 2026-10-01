import { mutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import { agentKeys } from './queries';
import type {
  Conversation,
  CreateConversationPayload,
  EditImageRequest,
  SkillMutationPayload,
  UpdateConversationPayload
} from './types';

/** 会话域失效：仅会话列表（标题/时间戳）变化，不连带资产查询 */
function invalidateConversations(): void {
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.conversations() });
}

/** 技能域失效：合并列表（预置 + 自定义）变化，selector 与管理页同步刷新 */
function invalidateSkills(): void {
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.skills() });
}

/** 资产域失效：列表 + 详情 */
function invalidateAssets(): void {
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.assetsRoot() });
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.assetRoot() });
}

export const createConversationMutation = mutationOptions({
  mutationFn: (data: CreateConversationPayload) =>
    apiClient<Conversation>('/agent/conversations', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  onSuccess: invalidateConversations
});

export const updateConversationMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: UpdateConversationPayload }) =>
    apiClient<Conversation>(`/agent/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    }),
  onSuccess: invalidateConversations
});

export const deleteConversationMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<{ success: boolean }>(`/agent/conversations/${id}`, { method: 'DELETE' }),
  onSuccess: invalidateConversations
});

export const deleteAssetMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<{ success: boolean }>(`/agent/assets/${id}`, { method: 'DELETE' }),
  onSuccess: invalidateAssets
});

/** 图片「继续修改」（直连 I2I）：生成可能耗时 10-60s，成功后失效资产列表/详情 */
export const editImageAssetMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: EditImageRequest }) =>
    apiClient<{ id: string }>(`/agent/assets/${id}/edit`, {
      method: 'POST',
      body: JSON.stringify(values)
    }),
  onSuccess: invalidateAssets
});

/** 收藏/取消收藏（任意 kind） */
export const setAssetFavoriteMutation = mutationOptions({
  mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
    apiClient<{ success: boolean; favorite: boolean }>(`/agent/assets/${id}/favorite`, {
      method: 'POST',
      body: JSON.stringify({ favorite })
    }),
  onSuccess: invalidateAssets
});

/** 批量删除（单次上限 100 个；服务端逐个校验归属并清理 OSS 对象） */
export const batchDeleteAssetsMutation = mutationOptions({
  mutationFn: (ids: string[]) =>
    apiClient<{ success: boolean; deleted: number }>('/agent/assets/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids })
    }),
  onSuccess: invalidateAssets
});

/** 创建自定义技能 */
export const createSkillMutation = mutationOptions({
  mutationFn: (data: SkillMutationPayload) =>
    apiClient<{ id: string }>('/agent/skills', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: invalidateSkills
});

/** 更新自定义技能（仅 uuid + 归属；预置只读） */
export const updateSkillMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: SkillMutationPayload }) =>
    apiClient<{ success: boolean }>(`/agent/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    }),
  onSuccess: invalidateSkills
});

/**
 * 删除自定义技能：服务端同时把引用它的会话 activeSkillId 置 null，
 * 故除技能列表外一并失效会话列表（侧边栏技能标识/回退需刷新）。
 */
export const deleteSkillMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<{ success: boolean }>(`/agent/skills/${id}`, { method: 'DELETE' }),
  onSuccess: () => {
    invalidateSkills();
    invalidateConversations();
  }
});
