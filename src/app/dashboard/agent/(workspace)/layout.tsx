import { getUserId } from '@/lib/auth-session';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { conversationsQueryOptions } from '@/features/agent/api/queries';
import { listConversations } from '@/features/agent/api/service';
import { ConversationSidebar } from '@/features/agent/components/conversations/conversation-sidebar';

/**
 * Agent 创作工作台布局：左侧会话列表 + 右侧对话区。
 * 外壳是固定高度列且由 page-scroller 承担滚动，这里只需撑满剩余高度、内部各自滚动。
 */
export default async function AgentWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const userId = await getUserId();
  if (!userId) return null;

  const queryClient = getQueryClient();
  void queryClient
    .infiniteQuery({
      ...conversationsQueryOptions(),
      queryFn: () => listConversations(userId)
    })
    .catch((error: unknown) => {
      console.error('[agent] conversation prefetch failed', error);
    });

  // 根节点必须带 flex-1：dashboard 外壳的 InfobarProvider 用 flex 行包裹页面内容，
  // 缺省会按内容收缩（shrink-to-fit）导致工作区靠左停靠、右侧留大块空白（历史 bug）。
  return (
    <div className='flex min-h-0 min-w-0 flex-1'>
      <aside className='hidden w-64 shrink-0 border-r lg:block'>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <ConversationSidebar />
        </HydrationBoundary>
      </aside>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
    </div>
  );
}
