import { getAsset } from '@/features/agent/api/service';
import { reserveCredits, settleCredits } from '@/features/credits/api/service';
import { priceEmbedding } from '@/features/credits/lib/pricing';
import type { ApiErrorCode } from '@/lib/api-error';
import { markDocumentFailed, replaceChunks } from '../api/service';
import {
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_DOCUMENT_BYTES,
  MAX_SOURCE_BYTES
} from '../constants/knowledge';
import { chunkText, htmlToText } from './chunk';
import { EmbeddingBatchError, embedTexts } from './embeddings';

/**
 * 摄取管线（server-only）：文本 → 切分 → 批量 embedding → 片段落库。
 *
 * 约定：
 * - 校验类错误（体积/片段数/资产不可导入）以 KnowledgeIngestError 抛出，
 *   由 Route Handler 映射为 4xx —— 此时文档行尚未创建或需回滚为 failed；
 * - 基础设施错误（embedding 调用、写库）不抛给用户：置文档 failed 并返回状态，
 *   前端展示「失败」并提供重试。
 */

export type KnowledgeIngestErrorCode =
  | 'empty_content'
  | 'too_large'
  | 'too_many_chunks'
  | 'asset_not_found'
  | 'asset_unsupported';

export class KnowledgeIngestError extends Error {
  readonly code: KnowledgeIngestErrorCode;

  constructor(code: KnowledgeIngestErrorCode, message: string) {
    super(message);
    this.name = 'KnowledgeIngestError';
    this.code = code;
  }
}

export type IngestStatus = 'ready' | 'failed';

export interface IngestResult {
  status: IngestStatus;
  chunkCount: number;
}

/** 校验类错误 → HTTP 语义映射（Route Handler 统一经 apiError 输出错误信封） */
export function ingestErrorStatus(code: KnowledgeIngestErrorCode): {
  status: number;
  code: ApiErrorCode;
} {
  switch (code) {
    case 'asset_not_found':
      return { status: 404, code: 'not_found' };
    case 'too_large':
      return { status: 413, code: 'payload_too_large' };
    default:
      return { status: 400, code: 'invalid_request' };
  }
}

/**
 * 从文本推导默认标题：取首个非空行，去掉 markdown 标题/列表标记，过长截断。
 * 用户显式传入标题时不用本函数。
 */
export function deriveTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '未命名文档';
  const cleaned = firstLine
    .replace(/^#+\s*/, '')
    .replace(/^[-*+]\s*/, '')
    .trim();
  const value = cleaned || firstLine;
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

/**
 * 从文本资产导入：读取正文并按类型转纯文本（html 去标签，markdown 原样）。
 * 归属校验复用 getAsset（越权与不存在同样返回空，不泄漏存在性）。
 */
export async function loadAssetText(
  userId: string,
  assetId: string
): Promise<{ title: string; text: string }> {
  const asset = await getAsset(userId, assetId);
  if (!asset) {
    throw new KnowledgeIngestError('asset_not_found', 'Source asset not found');
  }
  if (asset.kind !== 'markdown' && asset.kind !== 'html') {
    throw new KnowledgeIngestError(
      'asset_unsupported',
      'Only markdown or html assets can be imported'
    );
  }

  const raw = asset.content ?? '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_SOURCE_BYTES) {
    throw new KnowledgeIngestError('too_large', 'Source asset content too large');
  }
  return { title: asset.title, text: asset.kind === 'html' ? htmlToText(raw) : raw };
}

/**
 * 切分 + 上限校验（在写入文档行之前调用：校验失败不产生垃圾文档）。
 * 返回的片段即为 embedding 的输入，顺序与 chunkIndex 一致。
 */
export function prepareChunks(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    throw new KnowledgeIngestError('empty_content', 'Document content is empty');
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_DOCUMENT_BYTES) {
    throw new KnowledgeIngestError('too_large', 'Document content too large');
  }

  const chunks = chunkText(normalized);
  if (chunks.length === 0) {
    throw new KnowledgeIngestError('empty_content', 'Document content is empty');
  }
  if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
    throw new KnowledgeIngestError('too_many_chunks', 'Document produces too many chunks');
  }
  return chunks;
}

export async function reserveKnowledgeCredits(
  userId: string,
  chunks: string[]
): Promise<{ id: string; amount: number } | null> {
  const bytes = chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk, 'utf8'), 0);
  return reserveCredits({
    userId,
    amount: priceEmbedding(bytes),
    allowPartial: true,
    kind: 'knowledge',
    meta: { inputBytes: bytes }
  });
}

/**
 * 向量化 + 片段落库（replaceChunks 内部为事务：整体成功才置 ready）。
 * 异常不外抛：置 failed 后返回状态，端点据此应答（用户可在列表中重试）。
 */
export async function ingestChunks(params: {
  userId: string;
  documentId: string;
  chunks: string[];
  reservationId: string;
}): Promise<IngestResult> {
  let cost = 0;
  let tokens: number | undefined;
  let completed = false;
  let usageIncomplete = false;
  try {
    const result = await embedTexts(params.chunks);
    const { embeddings } = result;
    tokens = result.tokens;
    usageIncomplete = result.usageIncomplete;
    cost = priceEmbedding(tokens);
    if (embeddings.length !== params.chunks.length) {
      throw new Error(
        `Embedding count mismatch: expected ${params.chunks.length}, got ${embeddings.length}`
      );
    }
    await replaceChunks({
      userId: params.userId,
      documentId: params.documentId,
      chunks: params.chunks.map((content, index) => ({ content, embedding: embeddings[index] }))
    });
    completed = true;
    return { status: 'ready', chunkCount: params.chunks.length };
  } catch (error) {
    if (error instanceof EmbeddingBatchError) {
      tokens = error.knownTokens;
      cost = tokens > 0 ? priceEmbedding(tokens) : 0;
      usageIncomplete = true;
    }
    console.error('[knowledge] ingest failed:', { documentId: params.documentId, error });
    await markDocumentFailed(params.documentId).catch((markError) => {
      console.error('[knowledge] failed to mark document as failed:', markError);
    });
    return { status: 'failed', chunkCount: 0 };
  } finally {
    try {
      await settleCredits({
        reservationId: params.reservationId,
        cost,
        waive: !completed,
        meta: {
          documentId: params.documentId,
          tokens,
          outcome: completed ? 'ready' : 'failed',
          usageIncomplete: usageIncomplete || tokens === undefined
        }
      });
    } catch (error) {
      console.error('[knowledge] credit settlement failed; reservation remains pending', {
        documentId: params.documentId,
        reservationId: params.reservationId,
        cost,
        tokens,
        completed,
        usageIncomplete,
        error
      });
    }
  }
}
