import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  AssetDetail,
  AssetFilters,
  AssetsResponse,
  ConversationsResponse,
  SkillDetailsResponse,
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
  /** 技能域根 key：写操作后按此失效，目录与管理页详情一起刷新 */
  skillsRoot: () => [...agentKeys.all, 'skills'] as const,
  /** 轻量目录（选择器/空态）：不含正文 */
  skills: () => [...agentKeys.skillsRoot(), 'catalog'] as const,
  /** 完整内容（技能管理页） */
  skillDetails: () => [...agentKeys.skillsRoot(), 'details'] as const
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

export function fetchConversationPage(cursor: string | null): Promise<ConversationsResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const query = params.toString();
  return apiClient<ConversationsResponse>(`/agent/conversations${query ? `?${query}` : ''}`);
}

export const conversationsQueryOptions = () =>
  infiniteQueryOptions({
    queryKey: agentKeys.conversations(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchConversationPage(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor
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

/** 轻量技能目录：输入区选择器/空态用，不含正文；写操作后按 skillsRoot 失效 */
export const skillsQueryOptions = () =>
  queryOptions({
    queryKey: agentKeys.skills(),
    queryFn: () => apiClient<SkillsResponse>('/agent/skills'),
    staleTime: 60_000
  });

/** 技能完整内容（管理页编辑用）；与目录分开缓存，避免聊天页下载全部技能正文 */
export const skillDetailsQueryOptions = () =>
  queryOptions({
    queryKey: agentKeys.skillDetails(),
    queryFn: () => apiClient<SkillDetailsResponse>('/agent/skills?include=body'),
    staleTime: 60_000
  });
