'use client';

import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { createConversationMutation, updateConversationMutation } from '../../api/mutations';
import { agentKeys } from '../../api/queries';
import type { Conversation } from '../../api/types';
import { ConversationDrawer } from '../conversations/conversation-sidebar';
import { DEFAULT_MODEL, MODEL_UNAVAILABLE_MESSAGES } from '../../constants/models';
import { buildAssetReferenceText, type ReferencedAsset } from '../../lib/asset-reference';
import {
  clearPendingFirstMessage,
  setPendingFirstMessage,
  takePendingFirstMessage
} from '../../lib/pending-first-message';
import { ChatComposer } from './chat-composer';
import { ChatEmptyState } from './chat-empty-state';
import { MessageItem } from './message-item';
import { INSUFFICIENT_CREDITS_MESSAGE } from '@/features/credits/constants/credits';

/**
 * 解析对话流错误文案。
 * DefaultChatTransport 对非 2xx 响应抛 `new Error(await response.text())`，
 * 故 402 时 error.message 为错误信封 JSON 串；解析出 insufficient_credits 映射为余额不足文案。
 * 流内错误（服务端 toUIMessageStream 的 onError）以 errorText 抵达本组件：
 * 模型已下线/不存在这类已是可操作中文的文案直接原样展示，不再退化为通用提示。
 * 注意：下方是「精确匹配」而非模糊匹配 —— 服务端 onError 必须原样返回常量文案
 * （chat/route.ts 已注明），一旦被包装/加前缀就会静默退化，等于放弃可操作性。
 */
function resolveChatErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if ((MODEL_UNAVAILABLE_MESSAGES as readonly string[]).includes(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string } };
    if (parsed?.error?.code === 'insufficient_credits') return INSUFFICIENT_CREDITS_MESSAGE;
  } catch {
    // 非 JSON（网络错误 / 中断等），走默认文案
  }
  return '生成出错了，请重试。';
}

interface ChatWindowProps {
  conversation?: Conversation;
  initialMessages: UIMessage[];
}

/**
 * 对话窗口（官方可恢复流模式）。
 *
 * 每个会话挂载时创建独立 Chat 实例；`resume` 按官方模式由服务端已知的
 * activeStreamId 决定——仅当存在活跃流时才在挂载时 GET
 * /api/agent/chat/[id]/stream 重连（刷新/切回会话均实时恢复）。
 * 断开只是断开，不会取消生成；停止按钮走专用 stop 端点（真取消）。
 */
export function ChatWindow({ conversation, initialMessages }: ChatWindowProps) {
  const [initialConversationId] = useState(conversation?.id);
  const conversationIdRef = useRef(conversation?.id);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(conversation?.model ?? DEFAULT_MODEL);
  // 会话级技能（专家模式）：与模型选择同构，切换即持久化到会话
  const [skillId, setSkillId] = useState<string | null>(conversation?.activeSkillId ?? null);
  // 已选定的引用资产：提交时以机器可读块注入文本，让模型确定性地拿到 assetId
  const [referencedAssets, setReferencedAssets] = useState<ReferencedAsset[]>([]);
  const queryClient = useQueryClient();
  const router = useRouter();

  const createConversation = useMutation(createConversationMutation);
  const updateConversation = useMutation(updateConversationMutation);

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: initialConversationId,
    messages: initialMessages,
    // 官方恢复语义（Resume Streams 官方示例）：仅「服务端已知存在活跃流」才重连，
    // 不对既有会话无条件重连——新会话「创建 → 导航 → 挂载即发送首条消息」时，
    // 挂载重连 GET 的 204 分支（SDK 内部 setStatus('ready')）会把 sendMessage
    // 刚置上的 'submitted' 改回 'ready'，发送按钮要等首个 chunk 才变「停止」。
    resume: Boolean(conversation?.activeStreamId),
    transport: new DefaultChatTransport({
      api: '/api/agent/chat',
      body: () => ({ conversationId: conversationIdRef.current }),
      prepareReconnectToStreamRequest: ({ id }) => ({
        api: `/api/agent/chat/${id}/stream`
      })
    }),
    onFinish: () => {
      // 分域失效：会话列表（标题/updatedAt 变化）+ 资产列表（聊天中可能新增资产）
      void queryClient.invalidateQueries({ queryKey: agentKeys.conversations() });
      void queryClient.invalidateQueries({ queryKey: agentKeys.assetsRoot() });
    }
  });

  // 新会话首页 → 会话页的一次性首条消息交接（真实导航完成后由本页发送）。
  // 回到新会话首页（无 id）时丢弃未消费的交接，避免陈旧消息被误发送。
  // 发送必须放进宏任务（setTimeout 0）：开发态 StrictMode 挂载时会模拟卸载
  // （setup → cleanup → setup），其中 useChat 的卸载清理 chat.stop() 会 abort
  // 挂载 effect 同步发出的 sendMessage——它在消息准备阶段的 await 点被中止后
  // 静默返回（不推消息、不发请求），交接消息凭空消失（余额不足 402 等错误
  // 也因此永不出现）。延迟一个宏任务可避开模拟卸载窗口；cleanup 的
  // clearTimeout 保证真实卸载时不误发（交接保留，由同会话下次挂载消费，
  // 时效窗口兜底）。
  useEffect(() => {
    if (!initialConversationId) {
      clearPendingFirstMessage();
      return;
    }
    const timer = setTimeout(() => {
      const pendingText = takePendingFirstMessage(initialConversationId);
      if (pendingText) {
        void sendMessage({ text: pendingText });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialConversationId, sendMessage]);

  const isGenerating = status === 'submitted' || status === 'streaming';

  // 引用去重（选择器已置灰已引用项，此处再兜一道）；函数式更新保证批量添加逐项生效
  const handleAddReference = useCallback((asset: ReferencedAsset) => {
    setReferencedAssets((prev) =>
      prev.some((item) => item.id === asset.id) ? prev : [...prev, asset]
    );
  }, []);

  const handleRemoveReference = useCallback((id: string) => {
    setReferencedAssets((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleSubmit = async () => {
    const userText = input.trim();
    if (!userText || isGenerating || createConversation.isPending) return;
    const text = buildAssetReferenceText(referencedAssets, userText);

    if (!conversationIdRef.current) {
      try {
        const created = await createConversation.mutateAsync({ model, activeSkillId: skillId });
        // 必须真实导航（router.replace）进入会话页；不能用 window.history.replaceState——
        // 那会让 URL 与渲染树脱节，之后回到 /dashboard/agent 时组件被复用、状态不重置。
        // 首条消息经一次性交接由目标页消费发送（导航会重挂载本组件）。
        setPendingFirstMessage(created.id, text);
        setInput('');
        setReferencedAssets([]);
        router.replace(`/dashboard/agent/${created.id}`);
      } catch {
        toast.error('创建会话失败，请稍后重试');
      }
      return;
    }

    setInput('');
    setReferencedAssets([]);
    void sendMessage({ text });
  };

  // 停止：先通知服务端取消生产（并保存部分快照），再关闭本地读取。
  // 流 id 取当前 assistant 消息 metadata 中的值（随流下发、始终为最新）；
  // SSR 冻结的 conversation prop 在本页生命周期内不会更新，不能用于停止请求——
  // 否则会与 stop 端点的防误杀守卫冲突导致停止静默失效。
  // 注意：不要在任何"离开页面/卸载"场景调用 stop 端点——离开属于断开，应保持可恢复。
  const handleStop = () => {
    const conversationId = conversationIdRef.current;
    if (conversationId) {
      const last = messages.at(-1);
      const assistantMessage = last?.role === 'assistant' ? last : undefined;
      const activeStreamId =
        (assistantMessage?.metadata as { streamId?: string } | undefined)?.streamId ?? null;
      void fetch(`/api/agent/chat/${conversationId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantMessage, activeStreamId })
      }).catch(() => {
        // 失败静默可接受（服务端会继续生产，与可恢复流设计自洽）；仅避免未处理的 rejection
      });
    }
    stop();
  };

  const handleModelChange = (next: string) => {
    setModel(next);
    const conversationId = conversationIdRef.current;
    if (conversationId) {
      updateConversation.mutate({ id: conversationId, values: { model: next } });
    }
  };

  // 完全仿 handleModelChange：本地立即生效 + 有会话则持久化（null = 清除回通用）；
  // 新建会话时只更新本地态，随首条消息创建会话时一并带上
  const handleSkillChange = (next: string | null) => {
    setSkillId(next);
    const conversationId = conversationIdRef.current;
    if (conversationId) {
      updateConversation.mutate({ id: conversationId, values: { activeSkillId: next } });
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4'>
        <div className='flex min-w-0 items-center gap-1.5'>
          {/* 窄屏（<lg）侧边栏隐藏时的会话管理入口 */}
          <ConversationDrawer />
          <h1 className='truncate text-sm font-medium'>{conversation?.title ?? '新会话'}</h1>
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {/* min-h-full：消息不足一屏时容器仍撑满滚动区高度，空态得以真正垂直居中 */}
        <div className='mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6'>
          {messages.length === 0 ? (
            <ChatEmptyState onPick={setInput} />
          ) : (
            messages.map((message, index) => (
              <div
                key={message.id}
                className='[content-visibility:auto] [contain-intrinsic-size:auto_120px]'
              >
                <MessageItem
                  message={message}
                  // 仅最后一条 assistant 消息可能含进行中的 tool part；非流式期间视为已停止（AI SDK 中止语义下 part 不落终态）
                  isActive={
                    isGenerating && index === messages.length - 1 && message.role === 'assistant'
                  }
                />
              </div>
            ))
          )}
          {error && (
            <div className='border-destructive/40 bg-destructive/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm'>
              <span className='text-destructive'>{resolveChatErrorMessage(error)}</span>
              <Button
                variant='outline'
                size='sm'
                onClick={() => regenerate()}
                disabled={isGenerating}
              >
                重试
              </Button>
            </div>
          )}
        </div>
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={() => {
          void handleSubmit();
        }}
        onStop={handleStop}
        isGenerating={isGenerating}
        model={model}
        onModelChange={handleModelChange}
        skillId={skillId}
        onSkillChange={handleSkillChange}
        referencedAssets={referencedAssets}
        onAddReference={handleAddReference}
        onRemoveReference={handleRemoveReference}
      />
    </div>
  );
}
