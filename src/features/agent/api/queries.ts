import { queryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AssetDetail,
  AssetFilters,
  AssetsResponse,
  ConversationsResponse,
  SkillsResponse
} from './types';

export const agentKeys = {
  all: ['agent'] as const,
  conversations: () => [...agentKeys.all, 'conversations'] as const,
  /** 资产列表域根 key：按域失效时使用（避免 agentKeys.all 连带失效无关查询） */
  assetsRoot: () => [...agentKeys.all, 'assets'] as const,
  assets: (filters: AssetFilters) => [...agentKeys.assetsRoot(), filters] as const,
  /** 资产详情域根 key */
  assetRoot: () => [...agentKeys.all, 'asset'] as const,
  asset: (id: string) => [...agentKeys.assetRoot(), id] as const,
  /** 技能域 key：合并列表（预置 + 自定义），会话选择器与技能管理页共用一份缓存 */
  skills: () => [...agentKeys.all, 'skills'] as const
};

export function buildAssetQuery(filters: AssetFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.favorite !== undefined) params.set('favorite', String(filters.favorite));
  if (filters.sort) params.set('sort', filters.sort);
  return params.toString();
}

export const conversationsQueryOptions = () =>
  queryOptions({
    queryKey: agentKeys.conversations(),
    queryFn: () => apiClient<ConversationsResponse>('/agent/conversations')
  });

export const assetsQueryOptions = (filters: AssetFilters) =>
  queryOptions({
    queryKey: agentKeys.assets(filters),
    queryFn: () => apiClient<AssetsResponse>(`/agent/assets?${buildAssetQuery(filters)}`)
  });

export const assetQueryOptions = (id: string) =>
  queryOptions({
    queryKey: agentKeys.asset(id),
    queryFn: () => apiClient<AssetDetail>(`/agent/assets/${id}`)
  });

/** 合并技能列表（预置 + 自定义）：selector 与管理页共用，写操作后按 agentKeys.skills() 失效 */
export const skillsQueryOptions = () =>
  queryOptions({
    queryKey: agentKeys.skills(),
    queryFn: () => apiClient<SkillsResponse>('/agent/skills')
  });
