import { getUserId } from '@/lib/auth-session';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  toUIMessageStream,
  TypeValidationError,
  validateUIMessages,
  type ModelMessage,
  type UIMessage
} from 'ai';
import { after } from 'next/server';
import { createResumableStreamContext } from 'resumable-stream';
import {
  agentValidationTools,
  buildAgent,
  MAX_CHAT_OUTPUT_TOKENS,
  MAX_CHAT_STEPS,
  type AgentValidationUIMessage,
  type UsageSink
} from '@/features/agent/api/agent';
import { getSkillForUser } from '@/features/agent/api/skill-service';
import { GenerationError } from '@/features/agent/api/generation-error';
import {
  applyGeneratedTitle,
  clearConversationActiveStream,
  deleteTrailingMessages,
  getConversation,
  getMessagesContextSize,
  listMessages,
  saveUserMessage,
  setConversationActiveStream,
  syncConversationMessages
} from '@/features/agent/api/service';
import { prepareMessageAttachments } from '@/features/agent/api/attachment-urls';
import { MODEL_REGISTRY, isModelKey } from '@/features/agent/constants/models';
import { MAX_ATTACHMENTS_PER_MESSAGE } from '@/features/agent/api/types';
import { generateConversationTitle } from '@/features/agent/api/title-generation';
import { DEFAULT_CONVERSATION_TITLE } from '@/features/agent/constants/conversation';
import type { AgentChatMessage } from '@/features/agent/api/types';
import {
  consumeAgentStop,
  requestAgentStop,
  watchAgentStop
} from '@/features/agent/api/stop-signal';
import { detectModelUnavailable } from '@/features/agent/api/model-availability';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { matchesConversationSettings } from '@/features/agent/lib/conversation-settings';
import { checkBalance, reserveCredits, settleCredits } from '@/features/credits/api/service';
import { priceChat } from '@/features/credits/lib/pricing';
import { INSUFFICIENT_CREDITS_API_MESSAGE } from '@/features/credits/constants/credits';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';

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

function cancelledStreamResponse(): Response {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => writer.write({ type: 'abort' })
    })
  });
}

export async function POST(request: Request) {
  const userId = await getUserId();
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
  let body: {
    messages?: unknown;
    conversationId?: unknown;
    expectedModel?: unknown;
    expectedSkillId?: unknown;
    streamId?: unknown;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  // 增量协议：客户端每次只发最后一条消息（prepareSendMessagesRequest），
  // 历史以服务端 DB 为权威，claim 后读取合并——消除全量历史带来的请求体膨胀
  const incomingMessages = body.messages as UIMessage[] | undefined;
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
  if (!Array.isArray(incomingMessages) || incomingMessages.length !== 1 || !conversationId) {
    return apiError(
      400,
      'invalid_request',
      'messages (exactly one) and conversationId are required'
    );
  }
  const incomingMessage = incomingMessages[0];
  if (incomingMessage?.role !== 'user' || !Array.isArray(incomingMessage.parts)) {
    return apiError(400, 'invalid_request', 'Invalid message');
  }
  if (
    body.streamId !== undefined &&
    (typeof body.streamId !== 'string' || !isUuid(body.streamId))
  ) {
    return apiError(400, 'invalid_request', 'Invalid stream id');
  }
  if (incomingMessage.parts.length > MAX_PARTS_PER_MESSAGE) {
    return apiError(413, 'payload_too_large', 'Too many message parts');
  }
  if (
    incomingMessage.parts.filter((part) => part?.type === 'file').length >
    MAX_ATTACHMENTS_PER_MESSAGE
  ) {
    return apiError(400, 'invalid_request', 'Too many attachments');
  }

  const conversation = await getConversation(userId, conversationId);
  if (!conversation) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  if (!matchesConversationSettings(body, conversation)) {
    return apiError(409, 'settings_changed', 'Conversation settings changed');
  }

  // 计费入口拦截：限流后、建流前；余额 ≤0 直接 402（不发起上游调用，杜绝陌生人刷爆 API）
  // 并行：技能解析 / 余额校验 / 历史上下文规模（预算估算用）互不依赖
  const [skill, hasBalance, contextSize] = await Promise.all([
    getSkillForUser(userId, conversation.activeSkillId),
    checkBalance(userId),
    getMessagesContextSize(conversationId)
  ]);
  if (!hasBalance) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  // usage 累加器：onStepEnd 累加每步 token，onEnd 据此结算扣费（每请求新建，serverless 无跨请求污染）
  const usageSink: UsageSink = { inputTokens: 0, outputTokens: 0 };
  // LLM 标题生成（仅默认标题的首条消息）：与主生成并行，不阻塞流；usage 计入同一累加器
  let titlePromise: Promise<string> | null = null;

  // 开新流前先登记活跃流（官方要求开始新流时立即更新，防止窗口期刷新重连到旧流或拿 204）；
  // 停止信号消费端：stop 端点写 Redis 标志 → 这里轮询命中后 abort 底层生成（真取消）。
  const streamId = typeof body.streamId === 'string' ? body.streamId : generateId();

  if (await consumeAgentStop(conversationId, streamId)) {
    await saveUserMessage(conversationId, incomingMessage);
    return cancelledStreamResponse();
  }
  // 按上下文规模（DB 历史字节 + 本次增量消息 + 图片附件余量）与每步输出上限估算预算；
  // 增量协议下请求体不再含历史，历史规模须取自 DB；每张图按 4096 token 余量估（实际以 usage 结算）。
  const incomingFileParts = incomingMessage.parts.filter((part) => part?.type === 'file').length;
  const imageAllowance = (contextSize.fileParts + incomingFileParts) * 4096;
  const budget = priceChat(
    conversation.model,
    (contextSize.bytes + Buffer.byteLength(rawBody, 'utf8') + 4096 + imageAllowance) *
      MAX_CHAT_STEPS,
    MAX_CHAT_OUTPUT_TOKENS * MAX_CHAT_STEPS
  );
  const reservation = await reserveCredits({
    userId,
    amount: budget,
    allowPartial: true,
    kind: 'chat',
    meta: { conversationId, streamId, model: conversation.model }
  });
  if (!reservation) {
    return apiError(402, 'insufficient_credits', INSUFFICIENT_CREDITS_API_MESSAGE);
  }

  const releaseReservation = async () => {
    await settleCredits({ reservationId: reservation.id, cost: 0 }).catch((error) => {
      console.error('[agent] chat reservation release failed', {
        reservationId: reservation.id,
        error
      });
    });
  };
  let agent: ReturnType<typeof buildAgent>;
  try {
    agent = buildAgent({
      userId,
      conversationId,
      modelKey: conversation.model,
      skill,
      usageSink,
      reservationId: reservation.id
    });
  } catch (error) {
    await releaseReservation();
    throw error;
  }

  let claimed: boolean;
  try {
    claimed = await setConversationActiveStream(
      conversationId,
      streamId,
      conversation.activeStreamId
    );
  } catch (error) {
    await clearConversationActiveStream(conversationId, streamId).catch((cleanupError) => {
      console.error('[agent] chat stream cleanup failed', { conversationId, error: cleanupError });
    });
    await releaseReservation();
    throw error;
  }
  if (!claimed) {
    await releaseReservation();
    return apiError(409, 'stream_changed', 'Conversation stream changed');
  }

  // 建流前失败的统一清理：清活跃流登记 + 释放预留
  const rejectAfterClaim = async (response: Response): Promise<Response> => {
    await clearConversationActiveStream(conversationId, streamId).catch((cleanupError) => {
      console.error('[agent] chat stream cleanup failed', { conversationId, error: cleanupError });
    });
    await releaseReservation();
    return response;
  };

  let messages: UIMessage[];
  let modelMessages: ModelMessage[];
  try {
    // claim 后读历史：activeStreamId 已串行化并发生成，避免陈旧视图误删新轮次。
    // id 命中 = 编辑/重新生成（替换目标消息并删除旧尾部）；未命中 = 追加新消息。
    const historyRows = await listMessages(userId, conversationId);
    const historyMessages: UIMessage[] = (historyRows ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.parts,
      metadata: message.metadata ?? undefined
    }));
    const incomingIndex = historyMessages.findIndex((message) => message.id === incomingMessage.id);
    messages =
      incomingIndex >= 0
        ? [...historyMessages.slice(0, incomingIndex), incomingMessage]
        : [...historyMessages, incomingMessage];
    if (messages.length > MAX_MESSAGES) {
      return await rejectAfterClaim(apiError(413, 'payload_too_large', 'Too many messages'));
    }

    // 官方要求：含工具调用的消息在进入模型前必须先校验（畸形历史 → 400 而非 500）
    let validatedMessages: AgentValidationUIMessage[];
    try {
      validatedMessages = await validateUIMessages<AgentValidationUIMessage>({
        messages,
        tools: agentValidationTools
      });
    } catch (error) {
      if (TypeValidationError.isInstance(error)) {
        return await rejectAfterClaim(apiError(400, 'invalid_request', 'Invalid messages'));
      }
      throw error;
    }
    // 图片附件：file part 的稳定 /raw 路径重签为 OSS 签名 URL（百炼公网拉取）；
    // 非多模态模型移除全部 file part（客户端已按能力禁用附件，此处兜底）
    const vision = isModelKey(conversation.model)
      ? (MODEL_REGISTRY[conversation.model].capabilities.multimodal ?? false)
      : false;
    const resolvedMessages = await prepareMessageAttachments(userId, validatedMessages, vision);
    modelMessages = await convertToModelMessages(resolvedMessages, {
      ignoreIncompleteToolCalls: true
    });

    const staleStreamStop = conversation.activeStreamId
      ? requestAgentStop(conversationId, conversation.activeStreamId)
      : Promise.resolve();
    // 编辑/重新生成：先删除被取代的旧尾部（失败/半截回答或编辑点之后的旧内容）
    if (incomingIndex >= 0) {
      await deleteTrailingMessages(conversationId, incomingMessage.id);
    }
    const userText = extractText(incomingMessage);
    if (incomingIndex < 0 && userText && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      titlePromise = generateConversationTitle(userText, usageSink);
    }
    await Promise.all([saveUserMessage(conversationId, incomingMessage), staleStreamStop]);
    if (await consumeAgentStop(conversationId, streamId)) {
      return await rejectAfterClaim(cancelledStreamResponse());
    }
  } catch (error) {
    await clearConversationActiveStream(conversationId, streamId).catch((cleanupError) => {
      console.error('[agent] chat stream cleanup failed', { conversationId, error: cleanupError });
    });
    await releaseReservation();
    throw error;
  }

  const abortController = new AbortController();
  const stopWatching = watchAgentStop(conversationId, streamId, () => {
    abortController.abort();
  });

  const result = await agent
    .stream({
      messages: modelMessages,
      abortSignal: abortController.signal
    })
    .catch(async (error: unknown) => {
      // 建流失败：停止轮询并清理活跃流登记，避免轮询泄漏与幽灵引用
      stopWatching();
      await clearConversationActiveStream(conversationId, streamId).catch((cleanupError) => {
        console.error('[agent] chat stream cleanup failed', {
          conversationId,
          error: cleanupError
        });
      });
      await releaseReservation();
      throw error;
    });

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<AgentChatMessage>({
      execute: async ({ writer }) => {
        writer.merge(
          toUIMessageStream({
            stream: result.stream,
            originalMessages: messages as AgentChatMessage[],
            // 官方要求（持久化场景必须提供响应消息 id 生成器，resume 官方示例同款写法）：
            // 不提供时响应消息 id 为空串，空 id 会在 messages 主键上跨会话冲突，
            // 导致 onConflictDoUpdate 覆盖其他会话的内容（历史事故：串会话 + 消息丢失）
            generateMessageId: generateId,
            // 把本轮流 id 随响应消息的 metadata 下发（客户端停止时据此携带最新流 id）
            messageMetadata: ({ part }) => (part.type === 'start' ? { streamId } : undefined),
            // 流内错误映射：模型已下线/未开通时百炼返回 403（文案不含「已下线」），
            // 给出可操作的中文；文本必须与 constants/models.ts 的 MODEL_UNAVAILABLE_MESSAGES
            // 字面一致（客户端精确匹配后原样透传，见 chat-window.tsx）；
            // 生成类错误（图片/视频的 GenerationError）已携带用户可读中文（下载失败/超时/审核拒绝等），
            // 原样透传供给工具卡片（如 tool-video-part）直接展示——否则会被兜底文案掩盖真实原因；
            // 其余错误保持与客户端兜底文案一致的通用提示，详情只进服务端日志
            onError: (error: unknown) => {
              if (error instanceof GenerationError) return error.message;
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
              try {
                await syncConversationMessages(conversationId, messages, finalMessages);
                await clearConversationActiveStream(conversationId, streamId);
              } finally {
                try {
                  // 等标题生成完成（自带 8s 超时）再结算，把其 usage 计入本次扣费；
                  // 通常先于主流完成，不增加延迟
                  if (titlePromise) await titlePromise;
                  const hasUsage = usageSink.inputTokens > 0 || usageSink.outputTokens > 0;
                  const cost =
                    hasUsage || outcome.status !== 'failed'
                      ? priceChat(conversation.model, usageSink.inputTokens, usageSink.outputTokens)
                      : 0;
                  await settleCredits({
                    reservationId: reservation.id,
                    cost,
                    meta: {
                      model: conversation.model,
                      inputTokens: usageSink.inputTokens,
                      outputTokens: usageSink.outputTokens,
                      conversationId,
                      aborted: isAborted
                    }
                  });
                } catch (error) {
                  console.error(
                    '[agent] chat credit settlement failed; reservation remains pending',
                    {
                      conversationId,
                      reservationId: reservation.id,
                      model: conversation.model,
                      usage: usageSink,
                      outcome: outcome.status,
                      aborted: isAborted,
                      error
                    }
                  );
                }
              }
            }
          })
        );
        // 标题与主流并行：就绪即推 transient data part（不入消息 parts），
        // 客户端经 onData 更新会话头部并失效会话列表；落库带默认标题守卫
        if (titlePromise) {
          const title = await titlePromise;
          if (title !== DEFAULT_CONVERSATION_TITLE) {
            writer.write({ type: 'data-conversation-title', data: { title }, transient: true });
            await applyGeneratedTitle(userId, conversationId, title).catch((error) => {
              console.error('[agent] failed to persist generated title', { conversationId, error });
            });
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
      } catch (error) {
        // 降级：建立失败时清理活跃流登记并取消该分支，主响应仍继续直接流式返回
        console.error('[agent] resumable stream setup failed:', error);
        await clearConversationActiveStream(conversationId, streamId);
        await stream.cancel().catch(() => {});
      }
    }
  });
}
