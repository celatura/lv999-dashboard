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
import { cn } from '@/lib/utils';
import { assetsQueryOptions } from '../../api/queries';

const EXAMPLES = [
  {
    label: '写内容',
    description: '为咖啡品牌写几句宣传语',
    prompt: '为一个精品咖啡品牌写 3 版 slogan，每版保存为一个 Markdown 资产',
    icon: Icons.post
  },
  {
    label: '做图片',
    description: '生成一张秋日主题插画',
    prompt: '生成一张秋日树林的插画，暖色调，适合作为社交媒体配图',
    icon: Icons.media
  },
  {
    label: '生成视频',
    description: '让秋日树林的画面动起来',
    prompt: '生成一段秋日树林的短视频，镜头缓缓向前推进',
    icon: Icons.video
  },
  {
    label: '设计封面',
    description: '创作标题可编辑的封面',
    prompt:
      '做一张 3:4 小红书封面，主题秋日漫步，标题《杭州秋日漫步》、副标题「周末去哪儿」，标题文字可编辑',
    icon: Icons.palette
  }
] as const;

/** 复用示例：仅在资产库非空时展示，避免新用户首 run 点进「空库」的挫败体验 */
const REUSE_EXAMPLE = '看看我的资产库里有哪些作品，挑一个继续创作';

export function ChatEmptyState({ onPick }: { onPick: (text: string) => void }) {
  // 只取 total 判断库是否为空；与资产页/引用选择器共用 assets 缓存域，产出资产后自动失效刷新
  const { data } = useQuery({
    ...assetsQueryOptions({ page: 1, limit: 1 }),
    staleTime: 60_000
  });
  const hasAssets = (data?.total ?? 0) > 0;

  return (
    <Empty className='border-none p-0'>
      <EmptyHeader className='max-w-md'>
        <EmptyMedia variant='icon' className='size-10 rounded-xl'>
          <Icons.sparkles className='size-5' />
        </EmptyMedia>
        <EmptyTitle className='text-xl font-semibold tracking-tight'>Agent 创作工作台</EmptyTitle>
        <EmptyDescription>用一句话，创作内容、图片、视频或可编辑的设计。</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className='max-w-3xl items-stretch gap-3'>
        <div className='grid w-full grid-cols-2 overflow-hidden rounded-xl border'>
          {EXAMPLES.map(({ label, description, prompt, icon: Icon }, index) => (
            <button
              key={label}
              type='button'
              onClick={() => onPick(prompt)}
              className={cn(
                'bg-card hover:bg-muted/70 focus-visible:ring-ring relative flex min-w-0 items-start gap-3 p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
                index % 2 === 0 && 'border-r',
                index < 2 && 'border-b'
              )}
            >
              <span className='bg-muted text-foreground flex size-8 shrink-0 items-center justify-center rounded-lg'>
                <Icon className='size-4' aria-hidden='true' />
              </span>
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span className='text-foreground font-medium'>{label}</span>
                <span className='text-muted-foreground text-xs leading-relaxed'>{description}</span>
              </span>
            </button>
          ))}
        </div>
        {hasAssets && (
          <button
            type='button'
            onClick={() => onPick(REUSE_EXAMPLE)}
            className='text-muted-foreground hover:text-foreground focus-visible:ring-ring self-center rounded-md px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none'
          >
            从已有作品继续创作
          </button>
        )}
      </EmptyContent>
    </Empty>
  );
}
