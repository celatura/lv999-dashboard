'use client';

import { Pie, PieChart } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import type { AssetKindCount } from '../api/types';

/** 资产类型分布：各 kind 计数（数据来自 overview/api/service.ts 的 getAssetStats） */

const chartConfig = {
  count: {
    label: '资产数'
  },
  markdown: {
    label: 'Markdown',
    color: 'var(--chart-1)'
  },
  html: {
    label: 'HTML',
    color: 'var(--chart-2)'
  },
  image: {
    label: '图片',
    color: 'var(--chart-3)'
  },
  design: {
    label: '设计',
    color: 'var(--chart-4)'
  },
  video: {
    label: '视频',
    color: 'var(--chart-5)'
  }
} satisfies ChartConfig;

interface PieGraphProps {
  kindCounts: AssetKindCount[];
}

export function PieGraph({ kindCounts }: PieGraphProps) {
  const chartData = kindCounts
    .filter((item) => item.count > 0)
    .map((item) => ({
      kind: item.kind,
      count: item.count,
      fill: `var(--color-${item.kind})`
    }));
  const total = kindCounts.reduce((sum, item) => sum + item.count, 0);

  return (
    <Card className='flex h-full flex-col'>
      <CardHeader className='items-center pb-0'>
        <CardTitle>资产类型分布</CardTitle>
        <CardDescription>共 {total.toLocaleString('zh-CN')} 个资产，按类型统计</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-1 items-center justify-center pb-0'>
        {chartData.length === 0 ? (
          <div className='text-muted-foreground flex aspect-square max-h-[300px] min-h-[250px] w-full items-center justify-center text-sm'>
            还没有创作资产，先去 Agent 创作或设计画布产出作品吧。
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className='mx-auto aspect-square max-h-[340px] min-h-[250px] w-full'
          >
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey='kind' hideLabel />} />
              {/* 常规环形比例：面积与数值成正比；类型辨识交给底部图例而非扇区内白字 */}
              <Pie
                data={chartData}
                innerRadius='58%'
                outerRadius='92%'
                dataKey='count'
                nameKey='kind'
                cornerRadius={8}
                paddingAngle={4}
              />
              <ChartLegend content={<ChartLegendContent nameKey='kind' />} position='bottom' />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
