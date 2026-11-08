'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Icons } from '@/components/icons';
import { balanceQueryOptions } from '../api/queries';

/**
 * 账号下拉菜单内的 Credits 余额项（点击进流水页）。
 * 余额经轻量 GET /api/agent/credits 查询；由父级 DropdownMenu 的 open 状态控制 enabled
 * （下拉打开时才查，不常驻轮询，见 docs/credits.md）。
 */
export function SidebarCreditsItem({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { data } = useQuery({ ...balanceQueryOptions(), enabled });

  return (
    <DropdownMenuItem onClick={() => router.push('/dashboard/profile/credits')}>
      <Icons.creditCard className='mr-2 h-4 w-4' />
      可用 Credits：{data?.balance ?? '—'}
    </DropdownMenuItem>
  );
}
