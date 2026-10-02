import { requireUserId } from '@/lib/auth-session';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateId,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
  type InferAgentUIMessage,
  type UIMessage
} from 'ai';
import { after } from 'next/server';
import { createResumableStreamContext } from 'resumable-stream';
import {
  agentValidationTools,
  buildAgent,
  type AgentValidationUIMessage,
  type UsageSink
} from '@/features/agent/api/agent';
import { getSkillForUser } from '@/features/agent/api/skill-service';
import {
  applyAutoTitle,
  cleanupSupersededResponses,
  clearConversationActiveStream,
  getConversation,
  saveUserMessage,
  setConversationActiveStream,
  syncConversationMessages,
  touchConversation
} from '@/features/agent/api/service';
import { requestAgentStop, watchAgentStop } from '@/features/agent/api/stop-signal';
import { detectModelUnavailable } from '@/features/agent/api/model-availability';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { chargeCredits, checkBalance } from '@/features/credits/api/service';
import { priceChat } from '@/features/credits/lib/pricing';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_MESSAGES = 200;
const MAX_PARTS_PER_MESSAGE = 500;
const CHAT_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function extractText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 并行组 1：限流与读 body 互不依赖，同时发起、按「限流 → 体积 → 解析」顺序校验
  // （限流命中时 body 已读入内存，4MB 上限内可接受）。
  // 速率限制（按用户）：保护 LLM 调用成本（官方部署指南建议）
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('chat', userId, CHAT_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    return apiError(413, 'payload_too_large', 'Request body too large');
  }
  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const messages = body.messages as UIMessage[] | undefined;
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
  if (!Array.isArray(messages) || messages.length === 0 || !conversationId) {
    return apiError(400, 'invalid_request', 'messages and conversationId are required');
  }
  if (
    messages.length > MAX_MESSAGES ||
    messages.some(
      (message) => Array.isArray(message?.parts) && message.parts.length > MAX_PARTS_PER_MESSAGE
    )
  ) {
    return apiError(413, 'payload_too_large', 'Too many messages');
  }

  // 并行组 2：消息校验（CPU）与归属查询（DB）互不依赖；
  // 保持「校验失败 400 优先于会话不存在 404」语义。
  // 官方要求：含工具调用的消息在进入模型前必须先校验（畸形历史 → 400 而非 500）
  let validatedMessages: AgentValidationUIMessage[];
  let conversation: Awaited<ReturnType<typeof getConversation>>;
  try {
    [validatedMessages, conversation] = await Promise.all([
      validateUIMessages<AgentValidationUIMessage>({
        messages,
        tools: agentValidationTools
      }),
      getConversation(userId, conversationId)
    ]);
  } catch (error) {
    if (TypeValidationError.isInstance(error)) {
      return apiError(400, 'invalid_request', 'Invalid messages');
    }
    throw error;
  }
  if (!conversation) {
    return apiError(404, 'not_found', 'Conversation not found');
  }

  // 计费入口拦截：限流后、建流前；余额 ≤0 直接 402（不发起上游调用，杜绝陌生人刷爆 API）
  // 并行：技能解析（uuid → 查 DB 归属 / 预置 key → 常量 / 无 → undefined）与余额校验互不依赖
  const [skill, hasBalance] = await Promise.all([
    getSkillForUser(userId, conversation.activeSkillId),
    checkBalance(userId)
  ]);
  if (!hasBalance) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  // usage 累加器：onStepEnd 累加每步 token，onEnd 据此结算扣费（每请求新建，serverless 无跨请求污染）
  const usageSink: UsageSink = { inputTokens: 0, outputTokens: 0 };

  const agent = buildAgent({
    userId,
    conversationId,
    modelKey: conversation.model,
    skill,
    usageSink
  });
  type AgentUIMessage = InferAgentUIMessage<typeof agent>;

  // 开新流前先登记活跃流（官方要求开始新流时立即更新，防止窗口期刷新重连到旧流或拿 204）；
  // 停止信号消费端：stop 端点写 Redis 标志 → 这里轮询命中后 abort 底层生成（真取消）。
  const streamId = generateId();

  // 并行组 3：用户消息落库、活跃流登记、标题生成与旧流停止信号互不依赖
  //（DB 不同列写入 / Redis 信号），并行执行；
  // cleanup 保持在 saveUserMessage 之后（守卫：仅当该用户消息仍是会话最后一条用户消息）。
  // 并发防护：若仍有旧流在运行（如网络中断造成的幽灵生产），先发出停止信号再开新流
  const staleStreamStop = conversation.activeStreamId
    ? requestAgentStop(conversation.activeStreamId)
    : Promise.resolve();
  const lastUserMessage = messages.toReversed().find((message) => message.role === 'user');
  if (lastUserMessage) {
    const userText = extractText(lastUserMessage);
    // 请求开始先落用户消息（异常场景不丢输入），并使用首条消息生成会话标题
    await Promise.all([
      saveUserMessage(conversationId, lastUserMessage),
      setConversationActiveStream(conversationId, streamId),
      userText ? applyAutoTitle(userId, conversation, userText) : Promise.resolve(),
      staleStreamStop
    ]);
    await cleanupSupersededResponses(conversationId, lastUserMessage.id);
  } else {
    await Promise.all([setConversationActiveStream(conversationId, streamId), staleStreamStop]);
  }

  const abortController = new AbortController();
  const stopWatching = watchAgentStop(streamId, () => {
    abortController.abort();
  });

  const result = await agent
    .stream({
      messages: await convertToModelMessages(validatedMessages, {
        ignoreIncompleteToolCalls: true
      }),
      abortSignal: abortController.signal
    })
    .catch(async (error: unknown) => {
      // 建流失败：停止轮询并清理活跃流登记，避免轮询泄漏与幽灵引用
      stopWatching();
      await clearConversationActiveStream(conversationId, streamId);
      throw error;
    });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages as AgentUIMessage[],
      // 官方要求（持久化场景必须提供响应消息 id 生成器，resume 官方示例同款写法）：
      // 不提供时响应消息 id 为空串，空 id 会在 messages 主键上跨会话冲突，
      // 导致 onConflictDoUpdate 覆盖其他会话的内容（历史事故：串会话 + 消息丢失）
      generateMessageId: generateId,
      // 把本轮流 id 随响应消息的 metadata 下发（客户端停止时据此携带最新流 id）
      messageMetadata: ({ part }) => (part.type === 'start' ? { streamId } : undefined),
      // 流内错误映射：模型已下线/未开通时百炼返回 403（文案不含「已下线」），
      // 给出可操作的中文；文本必须与 constants/models.ts 的 MODEL_UNAVAILABLE_MESSAGES
      // 字面一致（客户端精确匹配后原样透传，见 chat-window.tsx）；
      // 其余错误保持与客户端兜底文案一致的通用提示，详情只进服务端日志
      onError: (error: unknown) => {
        const unavailable = detectModelUnavailable({
          channel: 'chat',
          error,
          detail: { conversationId, model: conversation.model }
        });
        if (unavailable) return unavailable;
        console.error('[agent] chat stream failed', { conversationId, error });
        return '生成出错了，请重试。';
      },
      onEnd: async ({ messages: finalMessages, isAborted, outcome }) => {
        stopWatching();
        // 按所有权更新：仅本轮新消息允许冲突更新，旧消息（客户端视图）不覆盖（见 service.ts）
        await syncConversationMessages(conversationId, messages, finalMessages);
        await clearConversationActiveStream(conversationId, streamId);
        await touchConversation(conversationId);
        // 结算扣费（仅 POST 生产者 onEnd 一次；GET 重连只读 Redis 流不触发，无双扣）：
        // 按 onStepEnd 累计 usage 结算，abort 也扣已完成步；completed/aborted 即使 usage 缺失也至少扣 1（兜底）；
        // failed 且无任何已完成步（0 token）→ 不扣（未产生生成）。结算失败不阻断已完成的流（消息已持久化）。
        const hasUsage = usageSink.inputTokens > 0 || usageSink.outputTokens > 0;
        if (hasUsage || outcome.status !== 'failed') {
          try {
            const cost = priceChat(
              conversation.model,
              usageSink.inputTokens,
              usageSink.outputTokens
            );
            await chargeCredits({
              userId,
              cost,
              kind: 'chat',
              meta: {
                model: conversation.model,
                inputTokens: usageSink.inputTokens,
                outputTokens: usageSink.outputTokens,
                conversationId,
                aborted: isAborted
              }
            });
          } catch (error) {
            console.error('[agent] chat credit settlement failed', { conversationId, error });
          }
        }
      }
    }),
    async consumeSseStream({ stream }) {
      // 交给 resumable-stream：生产者会在无人订阅时把流写完整（waitUntil 保活），
      // 客户端可在这条流进行中通过 GET /api/agent/chat/[id]/stream 重新订阅（刷新/切回实时重连）。
      try {
        const streamContext = createResumableStreamContext({ waitUntil: after });
        await streamContext.createNewResumableStream(streamId, () => stream);
        await setConversationActiveStream(conversationId, streamId);
      } catch (error) {
        // 降级：建立失败时清理活跃流登记并取消该分支，主响应仍继续直接流式返回
        console.error('[agent] resumable stream setup failed:', error);
        await clearConversationActiveStream(conversationId, streamId);
        await stream.cancel().catch(() => {});
      }
    }
  });
}
