import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** 固定柱高序列（%）：骨架屏由服务端渲染，渲染期取随机值会让服务端与 hydration 拿到不同高度 */
const BAR_HEIGHTS = [42, 68, 55, 80, 62, 95, 73, 58, 88, 47, 70, 36];

export function BarGraphSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-6 w-[160px]' />
          <Skeleton className='h-5 w-[60px] rounded-full' />
        </div>
        <Skeleton className='h-4 w-[150px]' />
      </CardHeader>
      <CardContent>
        <div className='flex aspect-auto h-[280px] w-full items-end justify-around gap-2 pt-8'>
          {BAR_HEIGHTS.map((height, i) => (
            <Skeleton key={i} className='w-full rounded-t-sm' style={{ height: `${height}%` }} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
