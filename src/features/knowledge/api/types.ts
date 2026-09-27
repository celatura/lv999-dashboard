import { z } from 'zod';
import { MAX_SEARCH_TOP_K } from '../constants/knowledge';
import type { KnowledgeSource, KnowledgeStatus } from '../constants/knowledge';

/**
 * RAG 知识库类型契约（前后端共用）。
 *
 * 服务端数据访问在 `api/service.ts`（server-only）；客户端经
 * `api/queries.ts` / `api/mutations.ts` 走 `/api/agent/knowledge/*` Route Handlers。
 */

export type { KnowledgeSource, KnowledgeStatus };

export interface KnowledgeDocument {
  id: string;
  title: string;
  source: KnowledgeSource;
  /** 导入来源资产 id（source='asset' 时非空；资产删除后置空） */
  sourceAssetId: string | null;
  /** 来源资产标题（资产仍存在时非空，供列表展示「来自《xxx》」） */
  sourceAssetTitle: string | null;
  status: KnowledgeStatus;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentFilters {
  page?: number;
  limit?: number;
  /** 标题模糊搜索 */
  search?: string;
  /** 逗号分隔的状态列表，如 "ready,failed" */
  status?: string;
  /** 逗号分隔的来源列表，如 "manual,asset" */
  source?: string;
  sort?: string;
}

export interface KnowledgeDocumentsResponse {
  documents: KnowledgeDocument[];
  total: number;
  page: number;
  limit: number;
}

/** 语义检索命中项：附来源文档标题，供 Agent 作答时标注引用 */
export interface KnowledgeSearchHit {
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  /** 相似度 = 1 - cosine 距离（越大越相关） */
  score: number;
}

// ---------------------------------------------------------------------------
// 预览（文档详情）
// ---------------------------------------------------------------------------

/** 文档详情（预览用）：列表字段 + 入库原文（只读快照，不做原文编辑） */
export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string;
}

/** 切分片段（预览用）：不返回 embedding（1024 维向量无展示价值且响应体巨大） */
export interface KnowledgeChunk {
  chunkIndex: number;
  content: string;
}

export interface KnowledgeDocumentDetailResponse {
  document: KnowledgeDocumentDetail;
  chunks: KnowledgeChunk[];
}

// ---------------------------------------------------------------------------
// 写操作请求体（Route Handler 校验用）
// ---------------------------------------------------------------------------

/**
 * 新增文档：按来源区分必填字段。
 * - manual：正文由客户端提交（content）
 * - asset：只提交 sourceAssetId，正文由服务端从资产读取（不信任客户端转述）
 */
export const createDocumentRequestSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('manual'),
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1)
  }),
  z.object({
    source: z.literal('asset'),
    title: z.string().min(1).max(200).optional(),
    sourceAssetId: z.string().uuid()
  })
]);

export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;

/**
 * 检索测试请求体：与 Agent `knowledgeSearch` 工具的参数范围一致
 * （query 1..500；topK 1..8 可选，缺省同工具默认 5），保证「测试所见 = 对话所得」。
 */
export const knowledgeSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  topK: z.number().int().min(1).max(MAX_SEARCH_TOP_K).optional()
});

export type KnowledgeSearchRequest = z.infer<typeof knowledgeSearchRequestSchema>;

export interface KnowledgeSearchResponse {
  results: KnowledgeSearchHit[];
}

/** 写入类端点（创建 / 重试）的应答：同步摄取完成后的文档态 */
export interface DocumentIngestResult {
  id: string;
  /** 'ready' 成功；'failed' 摄取异常（embedding / 写库），可在列表重试 */
  status: Extract<KnowledgeStatus, 'ready' | 'failed'>;
  chunkCount: number;
}
