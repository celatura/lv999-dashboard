import { requireUserId } from '@/lib/auth-session';
import type { UIMessage } from 'ai';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import {
  clearConversationActiveStream,
  getConversation,
  saveAssistantSnapshot
} from '@/features/agent/api/service';
import { requestAgentStop } from '@/features/agent/api/stop-signal';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';

export const runtime = 'nodejs';

/** 停止端点限流从宽（保证「停止」始终可用） */
const STOP_RATE_LIMIT = 60;
const STOP_RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 停止活跃生成（官方 stop 端点模式）：
 * 1) 保存客户端部分快照（只插不覆盖，避免旧快照覆盖服务端更新版本）
 * 2) 写入停止信号，生产者轮询后 abort 生成（部分内容由服务端权威落库）
 * 3) 校验后清理 activeStreamId（若仍指向同一流，避免误清之后启动的新流）
 *
 * 注：请求体解析失败时按空对象继续——停止是尽力而为的控制通道，保持始终可用。
 */
export async function POST(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 速率限制（按用户，从宽）：防止滥用停止端点
  if (!(await checkRateLimit('stop', userId, STOP_RATE_LIMIT, STOP_RATE_LIMIT_WINDOW_SECONDS))) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(STOP_RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  const conversation = await getConversation(userId, id);
  if (!conversation) {
    return apiError(404, 'not_found', 'Conversation not found');
  }

  const activeStreamId = conversation.activeStreamId;
  if (!activeStreamId) {
    return Response.json({ success: true });
  }

  // 请求体大小上限（复用 chat 路由的 4MB 约定）：assistantMessage 会原样入库，先设防
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    return apiError(413, 'payload_too_large', 'Request body too large');
  }
  let body: { activeStreamId?: string | null; assistantMessage?: UIMessage };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    body = {};
  }

  // 客户端携带了流 id 且与当前不一致 → 过期请求，忽略（避免误杀之后启动的新流）
  if (body.activeStreamId != null && body.activeStreamId !== activeStreamId) {
    return Response.json({ success: true });
  }

  if (body.assistantMessage) {
    await saveAssistantSnapshot(id, body.assistantMessage);
  }
  await requestAgentStop(activeStreamId);
  await clearConversationActiveStream(id, activeStreamId);
  return Response.json({ success: true });
}
