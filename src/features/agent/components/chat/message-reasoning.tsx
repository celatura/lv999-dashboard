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
  /** 服务端计时并随消息 metadata 持久化的总时长（毫秒）；历史消息优先展示 */
  durationMs?: number;
}

/**
 * 思考过程（reasoning）步骤行：思考中自动展开并跟随滚动，结束后 1s 自动收起。
 * 时长优先使用服务端计时并随消息 metadata 持久化的值（历史消息也有）；无持久化值时
 * （如中止未收到 reasoning-end）回退客户端本地计时，仍无则显示「思考过程」。
 *
 * 状态全部自持——MessageItem 是 memo 化的，新增 props 只传稳定原语（string / boolean / number），
 * 不击穿历史消息的重渲染防护。reasoning parts 本就随流下发并持久化，这里只做展示，
 * 不影响流协议、持久化与计费（reasoning token 已计入 outputTokens）。
 */
export function MessageReasoning({ text, isThinking, durationMs }: MessageReasoningProps) {
  const [open, setOpen] = useState(isThinking);
  const [measuredSeconds, setMeasuredSeconds] = useState<number | null>(null);
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
    setMeasuredSeconds(Math.max(1, Math.round(accumulatedMsRef.current / 1000)));
    const timer = setTimeout(() => setOpen(false), 1000);
    return () => clearTimeout(timer);
  }, [isThinking]);

  // 思考中面板保持贴底（思考内容是持续追加的，不跟随会停在开头看不到新内容）
  useEffect(() => {
    if (isThinking && open && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, isThinking, open]);

  // 优先使用服务端持久化时长（历史消息也有值）；没有时回退本次挂载观察到的本地计时
  const persistedSeconds =
    durationMs !== undefined ? Math.max(1, Math.round(durationMs / 1000)) : null;
  const durationSeconds = persistedSeconds ?? measuredSeconds;

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
