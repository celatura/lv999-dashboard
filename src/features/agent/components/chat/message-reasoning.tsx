'use client';

import { useEffect, useRef, useState } from 'react';
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

interface MessageReasoningProps {
  /** 合并后的思考正文（多个 reasoning part 按顺序拼接） */
  text: string;
  /** reasoning 是否正在流式输出 */
  isThinking: boolean;
}

/**
 * 思考过程（reasoning）步骤行：思考中自动展开并跟随滚动，结束后 1s 自动收起。
 * 时长在客户端按思考段落累计（历史消息拿不到时长时显示「思考过程」）。
 *
 * 状态全部自持——MessageItem 是 memo 化的，新增 props 只传稳定原语（string / boolean），
 * 不击穿历史消息的重渲染防护。reasoning parts 本就随流下发并持久化，这里只做展示，
 * 不影响流协议、持久化与计费（reasoning token 已计入 outputTokens）。
 */
export function MessageReasoning({ text, isThinking }: MessageReasoningProps) {
  const [open, setOpen] = useState(isThinking);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const startRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isThinking) {
      if (startRef.current === null) startRef.current = Date.now();
      setOpen(true);
      return;
    }
    // 从未观察到思考（初次挂载的历史消息）时不动展开态，避免抢走用户手动展开
    if (startRef.current === null) return;
    accumulatedMsRef.current += Date.now() - startRef.current;
    startRef.current = null;
    setDurationSeconds(Math.max(1, Math.round(accumulatedMsRef.current / 1000)));
    const timer = setTimeout(() => setOpen(false), 1000);
    return () => clearTimeout(timer);
  }, [isThinking]);

  // 思考中面板保持贴底（思考内容是持续追加的，不跟随会停在开头看不到新内容）
  useEffect(() => {
    if (isThinking && open && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, isThinking, open]);

  const line = (
    <TraceLine status={isThinking ? 'running' : undefined}>
      <TraceIcon>
        {isThinking ? <Icons.spinner className='animate-spin' /> : <Icons.sparkles />}
      </TraceIcon>
      <TraceTitle>
        {isThinking
          ? '思考中…'
          : durationSeconds !== null
            ? `思考了 ${durationSeconds} 秒`
            : '思考过程'}
      </TraceTitle>
    </TraceLine>
  );

  if (!text.trim()) {
    return <Trace>{line}</Trace>;
  }

  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div ref={contentRef} className='max-h-[200px] overflow-y-auto whitespace-pre-wrap'>
            {text}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
