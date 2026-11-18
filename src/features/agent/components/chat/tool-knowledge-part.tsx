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
import { ToolStep } from './tool-step';

/** 供消息渲染层断言使用：只声明渲染需要的字段，避免双重断言抹掉结构 */
export interface KnowledgeSearchToolPart {
  state: string;
  input?: { query?: string } | undefined;
  output?:
    | {
        results?:
          | { documentId: string; documentTitle: string; chunkIndex: number; score: number }[]
          | undefined;
      }
    | undefined;
  errorText?: string;
}

/**
 * knowledgeSearch 工具的调用状态渲染：
 * 检索中 → 步骤行；完成 → 「命中 N 个片段」可折叠来源条；未命中 → 中性提示；失败 → 错误步骤行。
 *
 * 只展示来源标题与数量，不渲染片段正文：来源可追溯即可，正文由 Agent 在回答中引用。
 * active 语义与 ToolAssetPart 一致（中止时进行中的 tool part 不落终态，非流式渲染收尾态）。
 */
export function ToolKnowledgePart({
  part,
  active
}: {
  part: KnowledgeSearchToolPart;
  active: boolean;
}) {
  const state = part.state;

  if (state === 'input-streaming' || state === 'input-available') {
    const query = part.input?.query;
    if (!active) {
      return <ToolStep state='stopped' title='已停止：知识库检索未完成' />;
    }
    return <ToolStep state='running' title={`正在检索知识库${query ? `：${query}` : '…'}`} />;
  }

  if (state === 'output-available') {
    const results = part.output?.results ?? [];
    if (results.length === 0) {
      return (
        <Trace>
          <TraceLine>
            <TraceIcon>
              <Icons.search />
            </TraceIcon>
            <TraceTitle>知识库中未找到相关资料</TraceTitle>
          </TraceLine>
        </Trace>
      );
    }

    // 按文档聚合（保持命中顺序），展示为「《标题》×片段数」
    const sources: { documentId: string; title: string; count: number }[] = [];
    for (const result of results) {
      const existing = sources.find((item) => item.documentId === result.documentId);
      if (existing) {
        existing.count += 1;
      } else {
        sources.push({
          documentId: result.documentId,
          title: result.documentTitle,
          count: 1
        });
      }
    }

    return (
      <Trace>
        <TraceCollapsible>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Icons.book />
              </TraceIcon>
              <TraceTitle>已检索知识库：命中 {results.length} 个片段</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <ul className='flex flex-wrap gap-1.5' aria-label='引用来源'>
              {sources.map((source) => (
                <li
                  key={source.documentId}
                  className='bg-muted text-foreground flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-xs'
                >
                  <span className='truncate'>{source.title}</span>
                  {source.count > 1 && (
                    <span className='text-muted-foreground shrink-0'>×{source.count}</span>
                  )}
                </li>
              ))}
            </ul>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }

  if (state === 'output-error') {
    return (
      <ToolStep state='error' title='知识库检索失败' errorText={part.errorText ?? '未知错误'} />
    );
  }

  return null;
}
