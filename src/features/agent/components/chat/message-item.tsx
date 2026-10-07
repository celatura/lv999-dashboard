'use client';

import type { TextUIPart, UIMessage } from 'ai';
import { isToolUIPart } from 'ai';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { Icons } from '@/components/icons';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getAssetKindMeta } from '../../constants/kinds';
import { parseAssetReferenceBlock, type ParsedAssetReference } from '../../lib/asset-reference';
import { STREAMDOWN_PLUGINS } from '../../lib/streamdown-plugins';
import { CopyButton } from '../copy-button';
import { ToolAssetPart, type CreateAssetToolPart } from './tool-asset-part';
import { ToolDesignPart, type DesignAssetToolPart } from './tool-design-part';
import { ToolImagePart, type ImageAssetToolPart } from './tool-image-part';
import { ToolVideoPart, type VideoAssetToolPart } from './tool-video-part';
import { ToolKnowledgePart, type KnowledgeSearchToolPart } from './tool-knowledge-part';

/**
 * 消息项：memo 化（props 全为稳定值：message 引用 + 两个布尔 + useCallback 回调）。
 * AI SDK 的 replaceMessage 只替换目标消息对象、其余消息引用不变，
 * 因此流式 chunk 与输入变化时，历史消息可真实跳过重渲染（Streamdown 解析成本高）。
 *
 * isActive：该消息是否为当前正在流式的最后一条 assistant 消息。
 * 既驱动进行中 tool part 的 loading 态，也作为 Streamdown 的 isAnimating
 * （显示流式光标 caret + 流式期间自动禁用复制/下载按钮）。
 * AI SDK 中止语义下进行中的 tool part 不会被置为终态（流以 abort 结束），
 * 因此只有 active 消息中的进行中 tool part 渲染为 loading，其余视为已停止收尾。
 *
 * 消息操作栏（复制 / 重新生成）：hover 或键盘聚焦时淡入。
 * 新增 props 必须保持引用稳定——onRegenerate 为父层 useCallback、isLastAssistant 为布尔，
 * 复制的 ✓ 态自持在 CopyButton 内部；否则任一次交互都会击穿 memo、重渲染整个历史列表。
 */
export const MessageItem = memo(function MessageItem({
  message,
  isActive = false,
  isLastAssistant = false,
  onRegenerate
}: {
  message: UIMessage;
  isActive?: boolean;
  /** 是否为最后一条 assistant 消息：只有它提供「重新生成」 */
  isLastAssistant?: boolean;
  /** 稳定回调（chat-window 用 useCallback 包裹 useChat 的 regenerate） */
  onRegenerate?: () => void;
}) {
  if (message.role === 'user') {
    return (
      <Message align='end'>
        <MessageContent>
          {message.parts.map((part, index) => {
            if (part.type !== 'text') return null;
            // 发送时注入的 [引用资产] 块渲染为 chip（不把 uuid 噪音抛给用户）
            const { references, text } = parseAssetReferenceBlock(part.text);
            return (
              <div key={index} className='flex flex-col items-end gap-1.5'>
                {references.length > 0 && (
                  <ul className='flex flex-wrap justify-end gap-1.5' aria-label='引用的资产'>
                    {references.map((reference) => (
                      <ReferenceChip key={reference.id} reference={reference} />
                    ))}
                  </ul>
                )}
                {text.trim() && (
                  <Bubble variant='secondary' align='end'>
                    <BubbleContent className='whitespace-pre-wrap'>{text}</BubbleContent>
                  </Bubble>
                )}
              </div>
            );
          })}
        </MessageContent>
      </Message>
    );
  }

  // 复制的是 Markdown 源码（各 text part 按渲染顺序拼接），不是渲染后的 innerText/HTML：
  // 保留标题/列表/代码块标记，粘走还能再编辑
  const messageText = message.parts
    .filter((part): part is TextUIPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim();
  // 仅最后一条 assistant 消息可重新生成：regenerate() 无参即重生成末尾消息，
  // 对历史中间消息 regenerate(messageId) 会截断其后所有对话，故不提供
  const canRegenerate = isLastAssistant && onRegenerate !== undefined;

  return (
    // flex-col：Message 默认是行布局（avatar + 正文），此处让正文与操作栏同列堆叠
    <Message align='start' className='flex-col gap-0.5'>
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text) return null;
            return (
              <div key={index} className='w-full'>
                <Streamdown plugins={STREAMDOWN_PLUGINS} caret='block' isAnimating={isActive}>
                  {part.text}
                </Streamdown>
              </div>
            );
          }
          if (isToolUIPart(part) && part.type === 'tool-createAsset') {
            return (
              <ToolAssetPart
                key={index}
                part={part as unknown as CreateAssetToolPart}
                active={isActive}
              />
            );
          }
          if (
            isToolUIPart(part) &&
            (part.type === 'tool-createImageAsset' || part.type === 'tool-editImageAsset')
          ) {
            return (
              <ToolImagePart
                key={index}
                part={part as unknown as ImageAssetToolPart}
                active={isActive}
                mode={part.type === 'tool-editImageAsset' ? 'edit' : 'create'}
              />
            );
          }
          if (
            isToolUIPart(part) &&
            (part.type === 'tool-createVideoAsset' ||
              part.type === 'tool-createVideoFromImageAsset')
          ) {
            return (
              <ToolVideoPart
                key={index}
                part={part as unknown as VideoAssetToolPart}
                active={isActive}
              />
            );
          }
          if (isToolUIPart(part) && part.type === 'tool-composeDesign') {
            return (
              <ToolDesignPart
                key={index}
                part={part as unknown as DesignAssetToolPart}
                active={isActive}
              />
            );
          }
          if (isToolUIPart(part) && part.type === 'tool-knowledgeSearch') {
            return (
              <ToolKnowledgePart
                key={index}
                part={part as unknown as KnowledgeSearchToolPart}
                active={isActive}
              />
            );
          }
          return null;
        })}
      </MessageContent>
      {(messageText.length > 0 || canRegenerate) && (
        <MessageFooter className='gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'>
          {messageText.length > 0 && <CopyButton text={messageText} disabled={isActive} />}
          {/* 流式中两按钮同禁：内容未完整，且防并发重roll。
              isActive 对「最后一条 assistant 消息」等价于全局 isGenerating（流式只发生在末尾），
              故不额外传 isGenerating——该 prop 每轮生成翻转两次，会击穿 memo 重渲染全部历史消息 */}
          {canRegenerate && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='重新生成回复'
                    disabled={isActive}
                    onClick={() => onRegenerate?.()}
                  >
                    <Icons.refresh />
                  </Button>
                }
              />
              {/* 重roll = 新一轮模型调用，按对话档再扣 Credits；tooltip 明示，避免误以为免费 */}
              <TooltipContent>重新生成（将再次消耗 Credits）</TooltipContent>
            </Tooltip>
          )}
        </MessageFooter>
      )}
    </Message>
  );
});

/** 已发送消息里的引用项：只展示类型图标 + 标题（id 仅模型需要） */
function ReferenceChip({ reference }: { reference: ParsedAssetReference }) {
  const { label, icon: KindIcon } = getAssetKindMeta(reference.kind);
  return (
    <li className='bg-muted text-muted-foreground flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs'>
      <KindIcon className='size-3.5 shrink-0' />
      <span className='text-foreground truncate'>{reference.title}</span>
      <span className='shrink-0'>{label}</span>
    </li>
  );
}
