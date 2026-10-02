import { Suspense } from 'react';
import { requireUserId } from '@/lib/auth-session';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { skillsQueryOptions } from '../../api/queries';
import { listSkillsForUser } from '../../api/skill-service';
import { SkillsTable, SkillsTableSkeleton } from './skills-table';

/**
 * 技能管理页数据壳（server）：预取合并列表（预置 + 自定义）并脱水给客户端表格。
 * 预取 queryFn 直连 service（服务端），返回结构必须与客户端 apiClient 一致（{ skills }），
 * 否则水合数据形状错乱（与知识库列表同一约定）。
 */
export default async function SkillsListing() {
  const userId = await requireUserId();
  if (!userId) return null;

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery({
    queryKey: skillsQueryOptions().queryKey,
    queryFn: async () => ({ skills: await listSkillsForUser(userId) })
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<SkillsTableSkeleton />}>
        <SkillsTable />
      </Suspense>
    </HydrationBoundary>
  );
}
