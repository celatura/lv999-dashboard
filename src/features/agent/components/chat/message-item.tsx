'use client';

import type { UIMessage } from 'ai';
import { isToolUIPart } from 'ai';
import { memo } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import { getAssetKindMeta } from '../../constants/kinds';
import { parseAssetReferenceBlock, type ParsedAssetReference } from '../../lib/asset-reference';
import { ToolAssetPart, type CreateAssetToolPart } from './tool-asset-part';
import { ToolDesignPart, type DesignAssetToolPart } from './tool-design-part';
import { ToolImagePart, type ImageAssetToolPart } from './tool-image-part';
import { ToolVideoPart, type VideoAssetToolPart } from './tool-video-part';
import { ToolKnowledgePart, type KnowledgeSearchToolPart } from './tool-knowledge-part';

/**
 * 消息项：memo 化（props 仅 message / isActive）。
 * AI SDK 的 replaceMessage 只替换目标消息对象、其余消息引用不变，
 * 因此流式 chunk 与输入变化时，历史消息可真实跳过重渲染（Streamdown 解析成本高）。
 *
 * isActive：该消息是否为当前正在流式的最后一条 assistant 消息。
 * 既驱动进行中 tool part 的 loading 态，也作为 Streamdown 的 isAnimating
 * （显示流式光标 caret + 流式期间自动禁用复制/下载按钮）。
 * AI SDK 中止语义下进行中的 tool part 不会被置为终态（流以 abort 结束），
 * 因此只有 active 消息中的进行中 tool part 渲染为 loading，其余视为已停止收尾。
 */
export const MessageItem = memo(function MessageItem({
  message,
  isActive = false
}: {
  message: UIMessage;
  isActive?: boolean;
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

  return (
    <Message align='start'>
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text) return null;
            return (
              <div key={index} className='w-full'>
                <Streamdown plugins={{ code, cjk }} caret='block' isAnimating={isActive}>
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
