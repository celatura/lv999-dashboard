import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { knowledgeSearchRequestSchema } from '@/features/knowledge/api/types';
import { searchKnowledgeByText } from '@/features/knowledge/lib/search';

export const runtime = 'nodejs';

/** 与知识库写端点同 scope：检索含一次 embedQuery（单条成本极低，仍需限流兜底） */
const KNOWLEDGE_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * 检索测试：与 Agent 的 `knowledgeSearch` 工具完全同链路 ——
 * 复用 searchKnowledgeByText（同一 embedQuery + SEARCH_MIN_SCORE 阈值过滤 + topK 上限），
 * 不得在此自写检索逻辑，保证「测试所见 = 对话所得」。
 * 纯读语义、零计费（embedQuery 已豁免，见 docs/credits.md §6.3）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 限流与读 body 并行；按「限流 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('knowledge', userId, KNOWLEDGE_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = knowledgeSearchRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid knowledge search');
  }

  const results = await searchKnowledgeByText(userId, parsed.data.query, parsed.data.topK);
  return Response.json({ results });
}
