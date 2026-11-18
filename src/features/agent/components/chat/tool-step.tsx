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

export type ToolStepState = 'running' | 'stopped' | 'error';

/**
 * 工具调用步骤行：进行中 / 已停止 / 失败三态的统一渲染（Trace 步骤视觉）。
 *
 * 进行中由 TraceLine status="running" 给标题加 shimmer；失败时若带 errorText，
 * 详情折叠在步骤行下（对齐 AI Elements Tool 模式），避免长错误信息挤占对话流。
 * 完成态不在此处渲染——各工具自己渲染资产卡 / 播放器等交付物。
 */
export function ToolStep({
  state,
  title,
  errorText
}: {
  state: ToolStepState;
  title: string;
  errorText?: string;
}) {
  const line = (
    <TraceLine status={state === 'running' ? 'running' : state === 'error' ? 'error' : undefined}>
      <TraceIcon>
        {state === 'running' ? (
          <Icons.spinner className='animate-spin' />
        ) : state === 'error' ? (
          <Icons.warning />
        ) : (
          <Icons.clock />
        )}
      </TraceIcon>
      <TraceTitle className='flex-1 whitespace-normal'>{title}</TraceTitle>
    </TraceLine>
  );

  if (state === 'error' && errorText) {
    return (
      <Trace>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
          <TraceCollapsibleContent className='whitespace-pre-wrap'>
            {errorText}
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }

  return <Trace>{line}</Trace>;
}
