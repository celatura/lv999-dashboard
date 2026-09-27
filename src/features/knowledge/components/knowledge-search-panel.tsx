'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Icons } from '@/components/icons';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { searchKnowledgeMutation } from '../api/mutations';
import type { KnowledgeSearchHit } from '../api/types';
import { DEFAULT_SEARCH_TOP_K, MAX_SEARCH_TOP_K, SEARCH_MIN_SCORE } from '../constants/knowledge';

/** topK 选项：与 Agent knowledgeSearch 工具上限一致（1..8，默认 5） */
const TOP_K_OPTIONS = Array.from({ length: MAX_SEARCH_TOP_K }, (_, index) => index + 1);

/** 结果片段超过该字数才提供展开/收起（短片段直接全文展示，减少一次点击） */
const COLLAPSE_CHARS = 200;

/** 单条命中：分数（3 位小数 + 可视化条）+ 文档标题 + 片段内容（截断可展开） */
function SearchResultItem({ hit }: { hit: KnowledgeSearchHit }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = hit.content.length > COLLAPSE_CHARS;
  // score = 1 - cosine 距离，理论范围 [0,1]；钳位防异常值撑破进度条
  const percent = Math.round(Math.max(0, Math.min(1, hit.score)) * 100);

  return (
    <li className='rounded-lg border p-3'>
      <div className='mb-1.5 flex items-center gap-2'>
        <span className='text-muted-foreground text-xs tabular-nums'>#{hit.chunkIndex}</span>
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>{hit.documentTitle}</span>
        <span
          className='text-muted-foreground text-xs tabular-nums'
          title='相似度 = 1 - cosine 距离'
        >
          {hit.score.toFixed(3)}
        </span>
      </div>
      <div className='bg-muted mb-2 h-1 overflow-hidden rounded-full'>
        <div className='bg-primary h-full rounded-full' style={{ width: `${percent}%` }} />
      </div>
      <p className={cn('text-sm whitespace-pre-wrap', collapsible && !expanded && 'line-clamp-4')}>
        {hit.content}
      </p>
      {collapsible && (
        <button
          type='button'
          onClick={() => setExpanded((value) => !value)}
          className='text-muted-foreground hover:text-foreground mt-1 text-xs underline underline-offset-3'
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </li>
  );
}

/** 面板主体：查询输入 + topK 选择 + 结果/空态/错误 */
function SearchPanelBody() {
  const searchMutation = useMutation(searchKnowledgeMutation);
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(DEFAULT_SEARCH_TOP_K);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searchMutation.isPending) return;
    searchMutation.mutate({ query: trimmed, topK });
  };

  // 429 单独给出中文提示（限流误伤的预期路径），其余统一兜底文案
  const errorMessage =
    searchMutation.isError &&
    (searchMutation.error instanceof ApiError && searchMutation.error.status === 429
      ? '检索过于频繁，请稍后再试'
      : '检索失败，请稍后重试');
  const results = searchMutation.data?.results;

  return (
    <>
      <form onSubmit={handleSubmit} className='flex shrink-0 items-center gap-2 border-b px-4 py-3'>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='输入查询词，如：秋日漫步'
          maxLength={500}
          aria-label='检索查询词'
        />
        <Select
          value={String(topK)}
          onValueChange={(next) => {
            if (typeof next === 'string') setTopK(Number(next));
          }}
        >
          <SelectTrigger className='w-28 shrink-0' aria-label='返回片段数'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOP_K_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                返回 {value} 条
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type='submit'
          disabled={searchMutation.isPending || !query.trim()}
          className='shrink-0'
        >
          {searchMutation.isPending ? <Icons.spinner className='animate-spin' /> : <Icons.search />}
          检索
        </Button>
      </form>
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
        {errorMessage ? (
          <p className='text-destructive text-sm'>{errorMessage}</p>
        ) : results ? (
          results.length === 0 ? (
            <div className='text-muted-foreground rounded-lg border border-dashed p-4 text-sm'>
              未命中：可能该内容未收录，或查询词与文档表达差异过大（试试更接近原文的说法）。
            </div>
          ) : (
            <ul className='flex flex-col gap-3'>
              {results.map((hit) => (
                <SearchResultItem key={`${hit.documentId}-${hit.chunkIndex}`} hit={hit} />
              ))}
            </ul>
          )
        ) : (
          <p className='text-muted-foreground text-sm'>
            输入查询词后回车或点「检索」，查看实际命中的片段与相似度。
          </p>
        )}
      </div>
    </>
  );
}

/**
 * 检索测试面板（知识库页头部入口）：
 * 输入 query + topK → 服务端复用 searchKnowledgeByText —— 与 Agent `knowledgeSearch`
 * 工具同一链路（同 embedQuery、同 SEARCH_MIN_SCORE 阈值过滤、同 topK 上限），
 * 保证「测试所见 = 对话所得」；纯读语义、零计费。
 */
export function KnowledgeSearchPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        <Icons.search />
        检索测试
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl'>
          <DialogHeader className='shrink-0 border-b px-4 py-3 pr-12'>
            <DialogTitle>检索测试</DialogTitle>
            <DialogDescription>
              输入查询词，查看知识库实际会命中的 topK 片段与相似度（调试用，不消耗积分）。
            </DialogDescription>
          </DialogHeader>
          <SearchPanelBody />
          <div className='text-muted-foreground shrink-0 border-t px-4 py-2 text-xs'>
            与 Agent 对话中的检索同链路；分数 = 1 - cosine 距离，低于 {SEARCH_MIN_SCORE}{' '}
            的片段已被过滤。
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
