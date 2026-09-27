import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { assets, knowledgeChunks, knowledgeDocuments } from '@/lib/db/schema';
import { toVectorLiteral } from '@/lib/db/vector';
import { MAX_SEARCH_TOP_K } from '../constants/knowledge';
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  KnowledgeDocumentFilters,
  KnowledgeDocumentsResponse,
  KnowledgeSearchHit,
  KnowledgeSource
} from './types';

/**
 * 知识库数据访问层（server-only）。
 * 客户端查询走 `/api/agent/knowledge/*` Route Handlers，不直接引用本文件。
 * 所有查询都以 userId 为前置过滤条件（归属即权限）。
 */

type DocumentRow = typeof knowledgeDocuments.$inferSelect;

/** 片段插入批大小：单条 SQL 体积可控（每片段含 1024 维向量字面量） */
const CHUNK_INSERT_BATCH = 50;

function toDocument(row: DocumentRow, sourceAssetTitle: string | null): KnowledgeDocument {
  return {
    id: row.id,
    title: row.title,
    source: row.source as KnowledgeSource,
    sourceAssetId: row.sourceAssetId,
    sourceAssetTitle,
    status: row.status as KnowledgeDocument['status'],
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseDocumentOrderBy(sort?: string): SQL {
  if (!sort) return desc(knowledgeDocuments.createdAt);
  try {
    const parsed = JSON.parse(sort) as { id?: string; desc?: boolean }[];
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const direction = first?.desc ? desc : asc;
    switch (first?.id) {
      case 'title':
        return direction(knowledgeDocuments.title);
      case 'chunkCount':
        return direction(knowledgeDocuments.chunkCount);
      case 'createdAt':
        return direction(knowledgeDocuments.createdAt);
      default:
        return desc(knowledgeDocuments.createdAt);
    }
  } catch {
    return desc(knowledgeDocuments.createdAt);
  }
}

/** 逗号分隔筛选值 → 数组（空值视为未筛选），与 listAssets 的 kind 筛选同模式 */
function splitList(value?: string): string[] | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

export async function listDocuments(
  userId: string,
  filters: KnowledgeDocumentFilters
): Promise<KnowledgeDocumentsResponse> {
  const db = getDb();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));

  const conditions = [eq(knowledgeDocuments.userId, userId)];
  if (filters.search) {
    conditions.push(ilike(knowledgeDocuments.title, `%${filters.search}%`));
  }
  const statuses = splitList(filters.status);
  if (statuses) {
    conditions.push(inArray(knowledgeDocuments.status, statuses));
  }
  const sources = splitList(filters.source);
  if (sources) {
    conditions.push(inArray(knowledgeDocuments.source, sources));
  }
  const where = and(...conditions);

  // count 与分页数据互不依赖，并行执行；来源资产标题用 leftJoin 一次带出（资产已删则为 null）
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(knowledgeDocuments).where(where),
    db
      .select({ document: knowledgeDocuments, sourceAssetTitle: assets.title })
      .from(knowledgeDocuments)
      .leftJoin(assets, eq(knowledgeDocuments.sourceAssetId, assets.id))
      .where(where)
      .orderBy(parseDocumentOrderBy(filters.sort))
      .limit(limit)
      .offset((page - 1) * limit)
  ]);

  return {
    documents: rows.map((row) => toDocument(row.document, row.sourceAssetTitle)),
    total: Number(total),
    page,
    limit
  };
}

/** 创建文档行（status=processing），摄取由 ingest 管线随后完成 */
export async function createDocument(params: {
  userId: string;
  title: string;
  source: KnowledgeSource;
  content: string;
  sourceAssetId?: string | null;
}): Promise<KnowledgeDocument> {
  const db = getDb();
  const rows = await db
    .insert(knowledgeDocuments)
    .values({
      userId: params.userId,
      title: params.title,
      source: params.source,
      sourceAssetId: params.sourceAssetId ?? null,
      content: params.content,
      status: 'processing',
      chunkCount: 0
    })
    .returning();
  return toDocument(rows[0], null);
}

/** 读取文档正文（重嵌/重试用）：不存在与越权同样返回 undefined，不泄漏存在性 */
export async function getDocumentContent(
  userId: string,
  documentId: string
): Promise<{ title: string; content: string; status: string } | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      title: knowledgeDocuments.title,
      content: knowledgeDocuments.content,
      status: knowledgeDocuments.status
    })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.userId, userId)))
    .limit(1);
  return rows[0];
}

/** 文档详情（预览用）：列表字段 + 入库原文；不存在与越权同样返回 undefined（归属即权限） */
export async function getDocumentDetail(
  userId: string,
  documentId: string
): Promise<KnowledgeDocumentDetail | undefined> {
  const db = getDb();
  // 来源资产标题与 listDocuments 同模式：leftJoin 一次带出（资产已删则为 null）
  const rows = await db
    .select({
      document: knowledgeDocuments,
      sourceAssetTitle: assets.title
    })
    .from(knowledgeDocuments)
    .leftJoin(assets, eq(knowledgeDocuments.sourceAssetId, assets.id))
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return { ...toDocument(row.document, row.sourceAssetTitle), content: row.document.content };
}

/** 片段列表（预览用）：按 chunkIndex 升序；不 select embedding 列（1024 维向量无展示价值且响应体巨大） */
export async function listChunks(userId: string, documentId: string): Promise<KnowledgeChunk[]> {
  const db = getDb();
  return db
    .select({
      chunkIndex: knowledgeChunks.chunkIndex,
      content: knowledgeChunks.content
    })
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.documentId, documentId), eq(knowledgeChunks.userId, userId)))
    .orderBy(asc(knowledgeChunks.chunkIndex));
}

/** 删除文档（chunks 由外键 ON DELETE CASCADE 级联清理） */
export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.userId, userId)))
    .returning({ id: knowledgeDocuments.id });
  return rows.length > 0;
}

/**
 * 片段落库 + 状态推进（同一事务）：
 * 先清旧片段再插新片段，保证「重试」不会与上一次残留混在一起；
 * 事务内更新状态，避免出现「片段已写但状态仍 processing」的中间态被检索到。
 */
export async function replaceChunks(params: {
  userId: string;
  documentId: string;
  chunks: { content: string; embedding: number[] }[];
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, params.documentId));
    for (let start = 0; start < params.chunks.length; start += CHUNK_INSERT_BATCH) {
      const batch = params.chunks.slice(start, start + CHUNK_INSERT_BATCH);
      await tx.insert(knowledgeChunks).values(
        batch.map((chunk, offset) => ({
          documentId: params.documentId,
          userId: params.userId,
          chunkIndex: start + offset,
          content: chunk.content,
          embedding: chunk.embedding
        }))
      );
    }
    await tx
      .update(knowledgeDocuments)
      .set({ status: 'ready', chunkCount: params.chunks.length, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, params.documentId));
  });
}

/** 摄取失败：清理半截片段并置 failed（否则失败文档的残留片段仍会被检索到） */
export async function markDocumentFailed(documentId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
    await tx
      .update(knowledgeDocuments)
      .set({ status: 'failed', chunkCount: 0, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, documentId));
  });
}

/**
 * 语义检索：cosine 距离 `<=>` 升序取 topK（HNSW 近似索引）。
 * score = 1 - 距离，越大越相关；仅检索 status='ready' 的文档片段。
 */
export async function searchKnowledge(
  userId: string,
  queryVector: number[],
  topK: number
): Promise<KnowledgeSearchHit[]> {
  const db = getDb();
  const limit = Math.min(MAX_SEARCH_TOP_K, Math.max(1, Math.floor(topK)));
  // 向量以文本字面量传参并显式 ::vector（与 customType 的序列化保持一致）
  const distance = sql<number>`${knowledgeChunks.embedding} <=> ${toVectorLiteral(queryVector)}::vector`;

  const rows = await db
    .select({
      documentId: knowledgeChunks.documentId,
      documentTitle: knowledgeDocuments.title,
      chunkIndex: knowledgeChunks.chunkIndex,
      content: knowledgeChunks.content,
      distance
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
    .where(and(eq(knowledgeChunks.userId, userId), eq(knowledgeDocuments.status, 'ready')))
    .orderBy(asc(distance))
    .limit(limit);

  return rows.map((row) => ({
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    chunkIndex: row.chunkIndex,
    content: row.content,
    score: Number((1 - Number(row.distance)).toFixed(4))
  }));
}
