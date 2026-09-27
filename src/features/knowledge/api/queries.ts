import { queryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  KnowledgeDocumentDetailResponse,
  KnowledgeDocumentFilters,
  KnowledgeDocumentsResponse
} from './types';

/**
 * 知识库查询键工厂 + 查询选项（客户端经 Route Handler 取数）。
 * 服务端预取必须复用同一 queryKey 与同一返回结构，否则水合数据形状会错乱。
 */
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  /** 文档列表域根 key：按域失效（不连带其他缓存） */
  documentsRoot: () => [...knowledgeKeys.all, 'documents'] as const,
  documents: (filters: KnowledgeDocumentFilters) =>
    [...knowledgeKeys.documentsRoot(), filters] as const,
  /** 文档详情（预览）：挂在列表域下，重新摄取/删除后随域失效一并重查 */
  detail: (id: string) => [...knowledgeKeys.documentsRoot(), 'detail', id] as const
};

export function buildKnowledgeQuery(filters: KnowledgeDocumentFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  if (filters.sort) params.set('sort', filters.sort);
  return params.toString();
}

export const knowledgeDocumentsQueryOptions = (filters: KnowledgeDocumentFilters) =>
  queryOptions({
    queryKey: knowledgeKeys.documents(filters),
    queryFn: () =>
      apiClient<KnowledgeDocumentsResponse>(
        `/agent/knowledge/documents?${buildKnowledgeQuery(filters)}`
      )
  });

/**
 * 文档详情（预览弹窗用）：staleTime=0，保证每次打开都重拉（摄取完成后片段数会变），
 * 命中缓存时先渲染旧数据并在后台刷新。
 */
export const knowledgeDocumentDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: knowledgeKeys.detail(id),
    queryFn: () => apiClient<KnowledgeDocumentDetailResponse>(`/agent/knowledge/documents/${id}`),
    staleTime: 0
  });
