import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { checkBalance } from '@/features/credits/api/service';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';
import { getDocumentContent } from '@/features/knowledge/api/service';
import {
  KnowledgeIngestError,
  ingestChunks,
  ingestErrorStatus,
  prepareChunks
} from '@/features/knowledge/lib/ingest';

export const runtime = 'nodejs';
/** 重试同样包含多次 embedding 调用，与创建端点保持一致的余量 */
export const maxDuration = 60;

/** 与创建端点同 scope：重试同样产生 embedding 计费 */
const KNOWLEDGE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 重新摄取（重试）：用文档已存正文重跑「切分 → embedding → 片段替换」。
 * 任意状态均可重试（含卡在 processing 的文档：函数超时中断时状态不会被推进），
 * replaceChunks 在事务内整体替换，重试幂等。
 */
export async function POST(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Document not found');
  }

  const allowed = await checkRateLimit(
    'knowledge',
    userId,
    KNOWLEDGE_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  // 计费入口拦截：余额 ≤0 直接 402（重试同样触发 embedding 计费）
  if (!(await checkBalance(userId))) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  const document = await getDocumentContent(userId, id);
  if (!document) {
    return apiError(404, 'not_found', 'Document not found');
  }

  let chunks: string[];
  try {
    chunks = prepareChunks(document.content);
  } catch (error) {
    if (error instanceof KnowledgeIngestError) {
      const mapped = ingestErrorStatus(error.code);
      return apiError(mapped.status, mapped.code, error.message);
    }
    throw error;
  }

  const result = await ingestChunks({ userId, documentId: id, chunks });
  return Response.json({ id, status: result.status, chunkCount: result.chunkCount });
}
