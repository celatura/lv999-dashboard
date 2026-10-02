import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { checkBalance } from '@/features/credits/api/service';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';
import { createDocument, listDocuments } from '@/features/knowledge/api/service';
import {
  createDocumentRequestSchema,
  type KnowledgeDocumentFilters
} from '@/features/knowledge/api/types';
import {
  KnowledgeIngestError,
  deriveTitle,
  ingestChunks,
  ingestErrorStatus,
  loadAssetText,
  prepareChunks
} from '@/features/knowledge/lib/ingest';
import {
  KNOWLEDGE_SOURCE_VALUES,
  KNOWLEDGE_STATUS_VALUES
} from '@/features/knowledge/constants/knowledge';

export const runtime = 'nodejs';
/** 摄取内含多次 embedding 调用（100KB 文本约 15 批），留出余量 */
export const maxDuration = 60;

/** 知识库写入限流：30 次/分/用户（写入会触发 embedding 计费，需保护） */
const KNOWLEDGE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 枚举筛选值（逗号分隔）：非法值直接丢弃，不返回 400，保持列表可用 */
function parseEnumList(value: string | null, allowed: readonly string[]): string | undefined {
  if (!value) return undefined;
  const allowedSet = new Set(allowed); // 单次建集，后续逐项 O(1) 查找
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => allowedSet.has(item));
  return items.length > 0 ? items.join(',') : undefined;
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const { searchParams } = new URL(request.url);
  const filters: KnowledgeDocumentFilters = {
    page: parseInteger(searchParams.get('page')),
    limit: parseInteger(searchParams.get('limit')),
    search: searchParams.get('search') ?? undefined,
    status: parseEnumList(searchParams.get('status'), KNOWLEDGE_STATUS_VALUES),
    source: parseEnumList(searchParams.get('source'), KNOWLEDGE_SOURCE_VALUES),
    sort: searchParams.get('sort') ?? undefined
  };

  const result = await listDocuments(userId, filters);
  return Response.json(result);
}

/**
 * 新增知识库文档：manual 用提交正文；asset 由服务端读取资产正文（不信任客户端转述）。
 * 流程：限流 → 体积 → 解析校验 → 切分校验 → 建文档行（processing）→ 同步摄取 → 返回文档态。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 限流与读 body 并行；按「限流 → 体积 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('knowledge', userId, KNOWLEDGE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  // 计费入口拦截：余额 ≤0 直接 402（摄取会触发 embedding 计费）
  if (!(await checkBalance(userId))) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    return apiError(413, 'payload_too_large', 'Request body too large');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = createDocumentRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid knowledge document');
  }

  // 正文与标题解析：asset 来源需回读资产（可能 404 / 类型不支持 / 过大）
  let text: string;
  let title: string;
  let sourceAssetId: string | null = null;
  let chunks: string[];
  try {
    if (parsed.data.source === 'manual') {
      text = parsed.data.content;
      title = parsed.data.title?.trim() || deriveTitle(text);
    } else {
      sourceAssetId = parsed.data.sourceAssetId;
      const asset = await loadAssetText(userId, sourceAssetId);
      text = asset.text;
      title = parsed.data.title?.trim() || asset.title;
    }
    // 切分与上限校验前置：校验失败不产生垃圾文档行
    chunks = prepareChunks(text);
  } catch (error) {
    if (error instanceof KnowledgeIngestError) {
      const mapped = ingestErrorStatus(error.code);
      return apiError(mapped.status, mapped.code, error.message);
    }
    throw error;
  }

  const document = await createDocument({
    userId,
    title,
    source: parsed.data.source,
    content: text,
    sourceAssetId
  });

  // MVP：请求内同步摄取（正文已有体积上限）；embedding/写库异常置 failed 而非抛给用户
  const result = await ingestChunks({ userId, documentId: document.id, chunks });
  return Response.json({
    id: document.id,
    status: result.status,
    chunkCount: result.chunkCount
  });
}
