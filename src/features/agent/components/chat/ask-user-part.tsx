'use client';

import { Icons } from '@/components/icons';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle
} from '@/components/ui/trace';

/** 供消息渲染层断言使用：只声明渲染需要的字段，避免双重断言抹掉结构 */
export interface AskUserToolPart {
  state: string;
  toolCallId: string;
  input?: { questions?: { question: string; choices: string[] }[] } | undefined;
  output?: { question: string; answer: string }[] | undefined;
  errorText?: string;
}

/**
 * askUser 的已回答状态：折叠展示「问题 → 用户回答」。
 * 未回答（input-available / input-streaming）不在这里渲染——由输入区上方的
 * QuestionCard 承接；已回答后卡片消失，本行作为对话步骤留痕。
 */
export function AskUserPart({ part }: { part: AskUserToolPart }) {
  if (part.state !== 'output-available' || !part.output?.length) {
    return null;
  }

  const count = part.output.length;

  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Icons.check />
            </TraceIcon>
            <TraceTitle>已确认 {count} 个创作细节</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <dl className='flex flex-col gap-2'>
            {part.output.map((entry) => (
              <div key={entry.question}>
                <dt className='text-muted-foreground'>{entry.question}</dt>
                <dd className='text-foreground'>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
