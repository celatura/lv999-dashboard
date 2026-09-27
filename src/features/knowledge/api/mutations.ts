import { mutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import { knowledgeKeys } from './queries';
import type {
  CreateDocumentRequest,
  DocumentIngestResult,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse
} from './types';

/** 文档域失效：写操作成功后重查列表（摄取为同步，回来即是终态） */
function invalidateDocuments(): void {
  void getQueryClient().invalidateQueries({ queryKey: knowledgeKeys.documentsRoot() });
}

/** 新增文档：manual 传 content；asset 只传 sourceAssetId（正文由服务端读取） */
export const createKnowledgeDocumentMutation = mutationOptions({
  mutationFn: (data: CreateDocumentRequest) =>
    apiClient<DocumentIngestResult>('/agent/knowledge/documents', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  onSuccess: invalidateDocuments
});

/** 上传文件新增文档：multipart 提交，解析/摄取均在服务端完成（应答与 JSON 创建同构） */
export const uploadKnowledgeDocumentMutation = mutationOptions({
  mutationFn: (data: { file: File; title?: string }) => {
    const form = new FormData();
    form.append('file', data.file);
    if (data.title?.trim()) form.append('title', data.title.trim());
    // FormData 不设 Content-Type：apiClient 已适配（浏览器自动带 multipart boundary）
    return apiClient<DocumentIngestResult>('/agent/knowledge/documents/upload', {
      method: 'POST',
      body: form
    });
  },
  onSuccess: invalidateDocuments
});

export const deleteKnowledgeDocumentMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<{ success: boolean }>(`/agent/knowledge/documents/${id}`, { method: 'DELETE' }),
  onSuccess: invalidateDocuments
});

/** 重新摄取：failed 文档、或因函数中断卡在 processing 的文档都可重跑（幂等替换片段） */
export const retryKnowledgeDocumentMutation = mutationOptions({
  mutationFn: (id: string) =>
    apiClient<DocumentIngestResult>(`/agent/knowledge/documents/${id}/retry`, { method: 'POST' }),
  onSuccess: invalidateDocuments
});

/**
 * 检索测试：与 Agent `knowledgeSearch` 工具同链路（服务端复用 searchKnowledgeByText）；
 * 每次提交都实拉实检（属调试语义），无缓存失效动作。
 */
export const searchKnowledgeMutation = mutationOptions({
  mutationFn: (data: KnowledgeSearchRequest) =>
    apiClient<KnowledgeSearchResponse>('/agent/knowledge/search', {
      method: 'POST',
      body: JSON.stringify(data)
    })
});
