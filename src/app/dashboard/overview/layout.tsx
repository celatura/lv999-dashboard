import { requireUserId } from '@/lib/auth-session';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardFooter
} from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { getAssetStats, getConversationStats } from '@/features/overview/api/service';
import type { AssetStats } from '@/features/overview/api/types';
import React from 'react';

export default async function OverViewLayout({
  sales,
  pie_stats,
  bar_stats,
  area_stats
}: {
  sales: React.ReactNode;
  pie_stats: React.ReactNode;
  bar_stats: React.ReactNode;
  area_stats: React.ReactNode;
}) {
  // 与并行路由槽同请求：getAssetStats 经 React.cache 去重，layout 与 4 个槽共用一轮统计查询
  const userId = await requireUserId();
  const [assetStats, conversationStats] = await Promise.all([
    getAssetStats(userId),
    getConversationStats(userId)
  ]);

  return (
    <PageContainer>
      <div className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center justify-between'>
          <h2 className='text-2xl font-bold tracking-tight'>你好，欢迎回来</h2>
        </div>

        <StatCards assetStats={assetStats} conversationTotal={conversationStats.total} />
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-7'>
          <div className='col-span-4'> {area_stats}</div>
          <div className='col-span-4 md:col-span-3'>
            {/* sales parallel routes */}
            {sales}
          </div>
          <div className='col-span-4'>{bar_stats}</div>
          <div className='col-span-4 min-h-0 md:col-span-3'>{pie_stats}</div>
        </div>
      </div>
    </PageContainer>
  );
}

/** 近 30 天环比上一个 30 天的变化百分比；基期为 0 时不可比，返回 null */
function getDeltaPercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

/** 4 张创作统计卡：资产总数 / 近 30 天新增（环比） / 创作会话 / 图片资产 */
function StatCards({
  assetStats,
  conversationTotal
}: {
  assetStats: AssetStats;
  conversationTotal: number;
}) {
  const deltaPercent = getDeltaPercent(assetStats.last30dCount, assetStats.prev30dCount);
  const trendingDown = deltaPercent !== null && deltaPercent < 0;

  return (
    <div className='*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4'>
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>资产总数</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {formatNumber(assetStats.total)}
          </CardTitle>
          <CardAction>
            <Badge variant='outline'>近 30 天 +{formatNumber(assetStats.last30dCount)}</Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            全部创作资产 <Icons.galleryVerticalEnd className='size-4' />
          </div>
          <div className='text-muted-foreground'>文本 · 图片 · 设计作品</div>
        </CardFooter>
      </Card>
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>近 30 天新增</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {formatNumber(assetStats.last30dCount)}
          </CardTitle>
          <CardAction>
            {deltaPercent === null ? (
              <Badge variant='outline'>
                <Icons.sparkles />
                新开始
              </Badge>
            ) : (
              <Badge variant='outline'>
                {trendingDown ? <Icons.trendingDown /> : <Icons.trendingUp />}
                {deltaPercent > 0 ? '+' : ''}
                {deltaPercent}%
              </Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            {deltaPercent === null
              ? '上一个 30 天没有新增'
              : `环比上一个 30 天${trendingDown ? '下降' : '增长'} ${Math.abs(deltaPercent)}%`}
            {deltaPercent === null ? (
              <Icons.sparkles className='size-4' />
            ) : trendingDown ? (
              <Icons.trendingDown className='size-4' />
            ) : (
              <Icons.trendingUp className='size-4' />
            )}
          </div>
          <div className='text-muted-foreground'>
            上一个 30 天新增 {formatNumber(assetStats.prev30dCount)} 个
          </div>
        </CardFooter>
      </Card>
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>创作会话</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {formatNumber(conversationTotal)}
          </CardTitle>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            与 Agent 的对话次数 <Icons.chat className='size-4' />
          </div>
          <div className='text-muted-foreground'>文本与图片创作都从会话开始</div>
        </CardFooter>
      </Card>
      <Card className='@container/card'>
        <CardHeader>
          <CardDescription>图片资产</CardDescription>
          <CardTitle className='text-2xl font-semibold tabular-nums @[250px]/card:text-3xl'>
            {formatNumber(assetStats.imageCount)}
          </CardTitle>
        </CardHeader>
        <CardFooter className='flex-col items-start gap-1.5 text-sm'>
          <div className='line-clamp-1 flex gap-2 font-medium'>
            文生图与图片编辑产物 <Icons.media className='size-4' />
          </div>
          <div className='text-muted-foreground'>可在「我的资产」继续修改或在画布使用</div>
        </CardFooter>
      </Card>
    </div>
  );
}
