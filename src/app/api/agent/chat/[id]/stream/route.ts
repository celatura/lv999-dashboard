import { requireUserId } from '@/lib/auth-session';
import { UI_MESSAGE_STREAM_HEADERS } from 'ai';
import { after } from 'next/server';
import { createResumableStreamContext } from 'resumable-stream';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { clearConversationActiveStream, getConversation } from '@/features/agent/api/service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 恢复端点：useChat({ resume: true }) 在挂载时（刷新/切回会话）自动 GET 此路由。
 * - 无活跃流：204（客户端直接使用数据库中的消息）
 * - 有活跃流：重连到进行中的流，先回放已缓冲内容再持续推送
 */
export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
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
    return new Response(null, { status: 204 });
  }

  const streamContext = createResumableStreamContext({ waitUntil: after });
  const stream = await streamContext.resumeExistingStream(activeStreamId);
  if (!stream) {
    // 流已结束或不存在（生产者实例异常退出等）：清理残留引用，后续以数据库消息为准
    await clearConversationActiveStream(id, activeStreamId);
    return new Response(null, { status: 204 });
  }

  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
