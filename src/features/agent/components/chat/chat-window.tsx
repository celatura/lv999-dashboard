'use client';

import type { UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller';
import { createConversationMutation, updateConversationMutation } from '../../api/mutations';
import { agentKeys } from '../../api/queries';
import { ASSET_KIND_VALUES, type AssetKind, type Conversation } from '../../api/types';
import { ConversationDrawer } from '../conversations/conversation-sidebar';
import { DEFAULT_MODEL } from '../../constants/models';
import {
  buildAssetReferenceText,
  parseAssetReferenceBlock,
  type ReferencedAsset
} from '../../lib/asset-reference';
import { resolveChatError } from '../../lib/chat-error';
import { buildStopRequestBody } from '../../lib/stop-request';
import { refreshConversationPageWithNotice } from '../../lib/refresh-conversations';
import {
  clearPendingFirstMessage,
  setPendingFirstMessage,
  setPendingNewConversationDraft,
  takePendingFirstMessage,
  takePendingNewConversationDraft
} from '../../lib/pending-first-message';
import { ChatComposer } from './chat-composer';
import { ChatEmptyState } from './chat-empty-state';
import { MessageItem } from './message-item';

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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [model, setModel] = useState(conversation?.model ?? DEFAULT_MODEL);
  // 会话级技能（专家模式）：与模型选择同构，切换即持久化到会话
  const [skillId, setSkillId] = useState<string | null>(conversation?.activeSkillId ?? null);
  const settingsRef = useRef({ model, skillId });
  const [isSyncingSettings, setIsSyncingSettings] = useState(false);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);
  const settingsRequestRef = useRef(false);
  const stopRequestRef = useRef(false);
  const [isStopping, setIsStopping] = useState(false);
  const requestStreamIdRef = useRef<string | null>(conversation?.activeStreamId ?? null);
  const [stoppedStreamId, setStoppedStreamId] = useState<string | null>(null);
  // 已选定的引用资产：提交时以机器可读块注入文本，让模型确定性地拿到 assetId
  const [referencedAssets, setReferencedAssets] = useState<ReferencedAsset[]>([]);
  const queryClient = useQueryClient();
  const router = useRouter();

  const createConversation = useMutation(createConversationMutation);
  const updateConversation = useMutation(updateConversationMutation);

  const { messages, sendMessage, status, stop, error, regenerate, clearError, resumeStream } =
    useChat({
      id: initialConversationId,
      messages: initialMessages,
      // 官方恢复语义（Resume Streams 官方示例）：仅「服务端已知存在活跃流」才重连，
      // 不对既有会话无条件重连——新会话「创建 → 导航 → 挂载即发送首条消息」时，
      // 挂载重连 GET 的 204 分支（SDK 内部 setStatus('ready')）会把 sendMessage
      // 刚置上的 'submitted' 改回 'ready'，发送按钮要等首个 chunk 才变「停止」。
      resume: Boolean(conversation?.activeStreamId),
      transport: new DefaultChatTransport({
        api: '/api/agent/chat',
        body: () => ({
          conversationId: conversationIdRef.current,
          expectedModel: settingsRef.current.model,
          expectedSkillId: settingsRef.current.skillId,
          streamId: requestStreamIdRef.current
        }),
        prepareReconnectToStreamRequest: ({ id }) => ({
          api: `/api/agent/chat/${id}/stream`
        })
      }),
      onFinish: () => {
        // 分域失效：会话列表（标题/updatedAt 变化）+ 资产列表（聊天中可能新增资产）
        if (conversationIdRef.current) {
          refreshConversationPageWithNotice(queryClient, conversationIdRef.current);
        }
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
      const draft = takePendingNewConversationDraft();
      if (draft) {
        setInput(draft.text);
        setReferencedAssets(draft.references);
      }
      return;
    }
    const timer = setTimeout(() => {
      const pendingText = takePendingFirstMessage(initialConversationId);
      if (pendingText) {
        requestStreamIdRef.current = crypto.randomUUID();
        void sendMessage({ text: pendingText });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialConversationId, sendMessage]);

  const isGenerating = status === 'submitted' || status === 'streaming';
  const chatError = error ? resolveChatError(error) : null;
  const controlsDisabled =
    isSyncingSettings ||
    settingsUnavailable ||
    isStopping ||
    createConversation.isPending ||
    Boolean(chatError?.isSizeLimit);
  const lastMessage = messages.at(-1);
  const assistantMessage = lastMessage?.role === 'assistant' ? lastMessage : undefined;
  const activeStreamId =
    (assistantMessage?.metadata as { streamId?: string } | undefined)?.streamId ?? null;
  const requestStreamId =
    status === 'streaming'
      ? (activeStreamId ?? requestStreamIdRef.current)
      : (requestStreamIdRef.current ?? activeStreamId);
  const canStop = Boolean(requestStreamId && requestStreamId !== stoppedStreamId);

  useEffect(() => {
    if (status === 'streaming' && activeStreamId) requestStreamIdRef.current = activeStreamId;
  }, [status, activeStreamId]);

  // 重新生成最后一条回复（regenerate() 无参 = 末尾 assistant 消息）。
  // regenerate 本身是 Chat 实例上的方法（引用恒定），useCallback 只是把这层包装也固定下来：
  // MessageItem 是 memo 化的，回调引用一变就会重渲染全部历史消息（Streamdown 解析贵）。
  const handleRegenerate = useCallback(() => {
    if (settingsRequestRef.current || stopRequestRef.current) return;
    requestStreamIdRef.current = crypto.randomUUID();
    void regenerate();
  }, [regenerate]);

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
    if (
      !userText ||
      isGenerating ||
      controlsDisabled ||
      settingsRequestRef.current ||
      stopRequestRef.current
    )
      return;
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
    requestStreamIdRef.current = crypto.randomUUID();
    const messageId = editingMessageId ?? undefined;
    setEditingMessageId(null);
    void sendMessage({ text, messageId });
  };

  const recoverFailedDraft = (): {
    text: string;
    references: ReferencedAsset[];
    id: string;
  } | null => {
    if (input.trim() || referencedAssets.length > 0) {
      toast.error('请先保存或清空输入框中的草稿。');
      return null;
    }
    const message = messages.toReversed().find((item) => item.role === 'user');
    const raw = message?.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n');
    if (!message || !raw) {
      toast.error('无法恢复原始输入，请复制消息后重试。');
      return null;
    }
    const parsed = parseAssetReferenceBlock(raw);
    const references: ReferencedAsset[] = [];
    for (const reference of parsed.references) {
      const kind = ASSET_KIND_VALUES.find((value): value is AssetKind => value === reference.kind);
      if (!kind) {
        toast.error('无法恢复引用资产，请复制消息后重试。');
        return null;
      }
      references.push({ id: reference.id, title: reference.title, kind });
    }
    return { text: parsed.text, references, id: message.id };
  };

  const handleEditFailedMessage = () => {
    const draft = recoverFailedDraft();
    if (!draft) return;
    setInput(draft.text);
    setReferencedAssets(draft.references);
    setEditingMessageId(draft.id);
    clearError();
  };

  const handleNewConversationWithDraft = () => {
    const draft = recoverFailedDraft();
    if (!draft) return;
    setPendingNewConversationDraft(draft.text, draft.references);
    router.push('/dashboard/agent');
  };

  const handleStop = async () => {
    const conversationId = conversationIdRef.current;
    if (!conversationId || !requestStreamId || stopRequestRef.current) return;
    stopRequestRef.current = true;
    setIsStopping(true);
    try {
      const snapshot = activeStreamId === requestStreamId ? assistantMessage : undefined;
      const { body, snapshotIncluded } = buildStopRequestBody(requestStreamId, snapshot);
      const result = await apiClient<{
        success: boolean;
        outcome: 'requested' | 'already_finished' | 'stale';
      }>(`/agent/chat/${conversationId}/stop`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000)
      });
      if (
        !result.success ||
        (result.outcome !== 'requested' && result.outcome !== 'already_finished')
      ) {
        throw new Error('The active stream changed before the stop request.');
      }
      if (snapshot && !snapshotIncluded) {
        toast.warning('消息过大，未能提交本地快照；最终内容以服务端保存结果为准。');
      }
      setStoppedStreamId(requestStreamId);
      await stop();
      clearError();
    } catch {
      toast.error('无法确认是否已停止，生成可能仍在继续。请检查网络后重试。');
    } finally {
      stopRequestRef.current = false;
      setIsStopping(false);
    }
  };

  const applySettings = (current: Conversation) => {
    settingsRef.current = { model: current.model, skillId: current.activeSkillId };
    setModel(current.model);
    setSkillId(current.activeSkillId);
    setSettingsUnavailable(false);
  };

  const syncSettings = async (values?: { model?: string; activeSkillId?: string | null }) => {
    const conversationId = conversationIdRef.current;
    if (!conversationId || settingsRequestRef.current) return false;
    settingsRequestRef.current = true;
    setIsSyncingSettings(true);
    try {
      if (values) {
        try {
          const updated = await updateConversation.mutateAsync({
            id: conversationId,
            values,
            signal: AbortSignal.timeout(10_000)
          });
          applySettings(updated);
          return true;
        } catch {
          toast.error('设置保存失败，正在确认当前会话设置。');
        }
      }
      const current = await apiClient<Conversation>(`/agent/conversations/${conversationId}`, {
        signal: AbortSignal.timeout(10_000)
      });
      applySettings(current);
      return true;
    } catch {
      setSettingsUnavailable(true);
      toast.error('无法确认会话设置，请检查网络后重新同步。');
      return false;
    } finally {
      settingsRequestRef.current = false;
      setIsSyncingSettings(false);
    }
  };

  const handleModelChange = (next: string) => {
    if (conversationIdRef.current) {
      void syncSettings({ model: next });
    } else {
      settingsRef.current.model = next;
      setModel(next);
    }
  };

  const handleSkillChange = (next: string | null) => {
    if (conversationIdRef.current) {
      void syncSettings({ activeSkillId: next });
    } else {
      settingsRef.current.skillId = next;
      setSkillId(next);
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

      <MessageScrollerProvider autoScroll defaultScrollPosition='last-anchor'>
        <MessageScroller className='min-h-0 flex-1'>
          <MessageScrollerViewport aria-label='对话消息'>
            {/* min-h-full：消息不足一屏时容器仍撑满滚动区高度，空态得以真正垂直居中 */}
            <MessageScrollerContent
              aria-busy={isGenerating}
              className='mx-auto w-full max-w-3xl px-4 py-6'
            >
              {messages.length === 0 ? (
                <ChatEmptyState onPick={setInput} />
              ) : (
                messages.map((message, index) => {
                  // 最后一条 assistant 消息：流式期间唯一 active 的消息，也是唯一可「重新生成」的对象
                  const isLastAssistant =
                    index === messages.length - 1 && message.role === 'assistant';
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                    >
                      <MessageItem
                        message={message}
                        // 仅最后一条 assistant 消息可能含进行中的 tool part；非流式期间视为已停止（AI SDK 中止语义下 part 不落终态）
                        isActive={isGenerating && isLastAssistant}
                        isLastAssistant={isLastAssistant}
                        onRegenerate={controlsDisabled ? undefined : handleRegenerate}
                      />
                    </MessageScrollerItem>
                  );
                })
              )}
              {chatError && (
                <MessageScrollerItem>
                  <div className='border-destructive/40 bg-destructive/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm'>
                    <span className='text-destructive'>{chatError.message}</span>
                    {chatError.isSizeLimit ? (
                      <div className='flex shrink-0 flex-wrap gap-2'>
                        <Button variant='outline' size='sm' onClick={handleEditFailedMessage}>
                          编辑输入
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={handleNewConversationWithDraft}
                        >
                          带输入新建会话
                        </Button>
                      </div>
                    ) : chatError.requiresSettingsSync ? (
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={isGenerating || controlsDisabled}
                        onClick={() => {
                          void syncSettings().then((synced) => {
                            if (synced) handleRegenerate();
                          });
                        }}
                        title='重试会再次消耗 Credits，可能再次生成资产'
                      >
                        同步并重试
                      </Button>
                    ) : chatError.requiresReconnect ? (
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={isGenerating || controlsDisabled}
                        onClick={() => void resumeStream()}
                      >
                        重新连接
                      </Button>
                    ) : (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleRegenerate}
                        disabled={isGenerating || controlsDisabled}
                        title='重试会再次消耗 Credits，可能再次生成资产'
                      >
                        重试
                      </Button>
                    )}
                    {!isGenerating &&
                      canStop &&
                      !chatError.isSizeLimit &&
                      !chatError.requiresSettingsSync && (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={isStopping}
                          onClick={() => void handleStop()}
                        >
                          停止生成
                        </Button>
                      )}
                  </div>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label='回到底部' />
        </MessageScroller>
      </MessageScrollerProvider>

      {(isSyncingSettings || settingsUnavailable) && (
        <div className='text-muted-foreground flex items-center justify-center gap-2 px-4 py-2 text-xs'>
          {isSyncingSettings ? (
            <span role='status'>正在同步会话设置…</span>
          ) : (
            <>
              <span role='alert'>无法确认会话设置，发送已暂停。</span>
              <Button variant='outline' size='sm' onClick={() => void syncSettings()}>
                重新同步
              </Button>
            </>
          )}
        </div>
      )}
      <ChatComposer
        value={input}
        onChange={setInput}
        onSubmit={() => {
          void handleSubmit();
        }}
        onStop={() => void handleStop()}
        isGenerating={isGenerating}
        isStopping={isStopping}
        canStop={canStop}
        controlsDisabled={controlsDisabled}
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
