import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { checkBalance } from '@/features/credits/api/service';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';
import { createDocument } from '@/features/knowledge/api/service';
import {
  ACCEPTED_FILE_EXTENSIONS,
  KnowledgeExtractError,
  extractErrorStatus,
  extractTextFromFile,
  fileBaseName
} from '@/features/knowledge/lib/extract';
import {
  KnowledgeIngestError,
  deriveTitle,
  ingestChunks,
  ingestErrorStatus,
  prepareChunks
} from '@/features/knowledge/lib/ingest';
import { MAX_UPLOAD_FILE_BYTES } from '@/features/knowledge/constants/knowledge';

export const runtime = 'nodejs';
/** 解析（本地毫秒级）+ 同步摄取（100KB 文本约 15 批 embedding），与 POST /documents 一致 */
export const maxDuration = 60;

/** 知识库写入限流：与 POST /documents 同 scope（30 次/分/用户，写入触发 embedding 计费） */
const KNOWLEDGE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * 上传文件新增知识库文档（multipart：file 必填 + title 可选）。
 * 流程：限流 → formData → 校验（File 实例 / 大小 / 扩展名白名单）→ 解析提取
 * → 切分校验 → 建文档行（processing, source='file'）→ 同步摄取 → 返回文档态。
 * 应答与 POST /documents 同构（DocumentIngestResult）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
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
  // 计费入口拦截：余额 ≤0 直接 402（摄取会触发 embedding 计费）
  if (!(await checkBalance(userId))) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'invalid_request', 'Expected multipart/form-data body');
  }

  const file = form.get('file');
  const submittedTitle = form.get('title');
  if (!(file instanceof File)) {
    return apiError(400, 'invalid_request', 'Missing file field');
  }
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    return apiError(413, 'payload_too_large', 'File too large');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(ACCEPTED_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    return apiError(
      400,
      'invalid_request',
      `Unsupported file type, accepted: ${ACCEPTED_FILE_EXTENSIONS.join(', ')}`
    );
  }

  // 解析与切分校验前置：失败不产生垃圾文档行
  let text: string;
  let chunks: string[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    text = await extractTextFromFile({ filename: file.name, buffer });
    chunks = prepareChunks(text);
  } catch (error) {
    if (error instanceof KnowledgeExtractError) {
      const mapped = extractErrorStatus(error.code);
      return apiError(mapped.status, mapped.code, error.message);
    }
    if (error instanceof KnowledgeIngestError) {
      const mapped = ingestErrorStatus(error.code);
      return apiError(mapped.status, mapped.code, error.message);
    }
    throw error;
  }

  const title =
    (typeof submittedTitle === 'string' ? submittedTitle.trim() : '') ||
    fileBaseName(file.name) ||
    deriveTitle(text);

  const document = await createDocument({
    userId,
    title,
    source: 'file',
    content: text,
    sourceAssetId: null
  });

  // MVP：请求内同步摄取；embedding/写库异常置 failed 而非抛给用户（列表可重试）
  const result = await ingestChunks({ userId, documentId: document.id, chunks });
  return Response.json({
    id: document.id,
    status: result.status,
    chunkCount: result.chunkCount
  });
}
