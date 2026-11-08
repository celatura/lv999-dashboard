'use client';

import { useQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { balanceQueryOptions } from '../api/queries';

/**
 * 当前 Credits 余额横幅（流水页头部）。
 * 轻量 GET /api/agent/credits；与账号下拉共用 balanceQueryOptions 缓存（creditKeys.balance）。
 */
export function CreditsBalanceBanner() {
  const { data, isPending, isError } = useQuery(balanceQueryOptions());

  return (
    <div className='bg-card flex items-center gap-3 rounded-lg border px-4 py-3'>
      <Icons.creditCard className='text-muted-foreground h-5 w-5' />
      <div className='flex flex-col'>
        <span className='text-muted-foreground text-xs'>可用 Credits</span>
        {isPending ? (
          <Skeleton className='mt-1 h-6 w-16' />
        ) : (
          <span className='text-2xl font-semibold tabular-nums'>
            {isError ? '加载失败' : data?.balance}
          </span>
        )}
        {data && (
          <span className='text-muted-foreground text-xs'>
            总额 {data.total} · 冻结 {data.reserved}
          </span>
        )}
      </div>
    </div>
  );
}
