'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty';
import { Icons } from '@/components/icons';
import { assetsQueryOptions } from '../../api/queries';

const EXAMPLES = [
  '写一篇介绍杭州秋日漫步路线的小红书文案，语气轻快，保存为 Markdown',
  '做一张 3:4 小红书封面，主题秋日漫步，标题《杭州秋日漫步》、副标题「周末去哪儿」',
  '生成一张杭州秋日漫步主题的小红书封面图',
  '生成一段秋日树林的短视频，镜头缓缓向前推进',
  '为一个精品咖啡品牌写 3 版 slogan，每版保存为一个 Markdown 资产',
  '做一个「星空观测入门指南」的单页 HTML 落地页，包含样式与简单交互'
];

/** 复用示例：仅在资产库非空时展示，避免新用户首 run 点进「空库」的挫败体验 */
const REUSE_EXAMPLE = '看看我的资产库里有哪些作品，挑一个继续创作';

export function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  // 只取 total 判断库是否为空；与资产页/引用选择器共用 assets 缓存域，产出资产后自动失效刷新
  const { data } = useQuery({
    ...assetsQueryOptions({ page: 1, limit: 1 }),
    staleTime: 60_000
  });
  const hasAssets = (data?.total ?? 0) > 0;
  const examples = hasAssets ? [...EXAMPLES, REUSE_EXAMPLE] : EXAMPLES;

  return (
    // p-0：Empty 默认 p-6 会让示例列比输入框各缩 24px，去掉后才能与 composer 边缘对齐
    <Empty className='border-none p-0'>
      <EmptyHeader className='max-w-md'>
        <EmptyMedia variant='icon' className='size-10 rounded-xl'>
          <Icons.sparkles className='size-5' />
        </EmptyMedia>
        <EmptyTitle className='text-xl font-semibold tracking-tight'>Agent 创作工作台</EmptyTitle>
        <EmptyDescription>
          用自然语言描述创作需求，Agent 会规划并产出 Markdown / HTML / 图片 / 视频 / 整版设计
          资产；也可以引用「我的资产」里的作品继续创作。
        </EmptyDescription>
      </EmptyHeader>
      {/* 与消息列/输入区同宽（max-w-3xl），保持整页一条稳定中轴 */}
      <EmptyContent className='max-w-3xl'>
        <div className='flex w-full flex-col gap-2'>
          {examples.map((example) => (
            <button
              key={example}
              type='button'
              onClick={() => onPick(example)}
              className='hover:bg-muted rounded-lg border px-3 py-2 text-left text-sm transition-colors'
            >
              {example}
            </button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  );
}
