import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { agentKeys, fetchConversationPage } from '../api/queries';
import type { ConversationsResponse } from '../api/types';

type ConversationPages = InfiniteData<ConversationsResponse, string | null>;

const pendingRefreshes = new WeakMap<QueryClient, Map<string | null, symbol>>();

export function cancelConversationPageRefreshes(queryClient: QueryClient): void {
  pendingRefreshes.get(queryClient)?.clear();
}

export async function refreshConversationPage(
  queryClient: QueryClient,
  conversationId: string
): Promise<void> {
  const cached = queryClient.getQueryData<ConversationPages>(agentKeys.conversations());
  const index = cached?.pages.findIndex((page) =>
    page.conversations.some((conversation) => conversation.id === conversationId)
  );
  if (!cached || index === undefined || index < 0) return;
  const cursor = cached.pageParams[index];
  if (cursor === undefined) return;

  let requests = pendingRefreshes.get(queryClient);
  if (!requests) {
    requests = new Map();
    pendingRefreshes.set(queryClient, requests);
  }
  const request = Symbol();
  requests.set(cursor, request);
  try {
    const refreshed = await fetchConversationPage(cursor);
    if (requests.get(cursor) !== request) return;
    const latest = queryClient.getQueryData<ConversationPages>(agentKeys.conversations());
    const latestIndex = latest?.pageParams.indexOf(cursor) ?? -1;
    if (
      latest &&
      latestIndex >= 0 &&
      latest.pages[latestIndex] === cached.pages[index] &&
      latest.pages.length > latestIndex + 1 &&
      latest.pages[latestIndex].nextCursor !== refreshed.nextCursor
    ) {
      cancelConversationPageRefreshes(queryClient);
      await queryClient.invalidateQueries(
        { queryKey: agentKeys.conversations() },
        { throwOnError: true }
      );
      return;
    }
    queryClient.setQueryData<ConversationPages>(agentKeys.conversations(), (current) => {
      if (!current) return current;
      const currentIndex = current.pageParams.indexOf(cursor);
      if (
        currentIndex < 0 ||
        current.pages[currentIndex] !== cached.pages[index] ||
        !current.pages[currentIndex].conversations.some((item) => item.id === conversationId)
      ) {
        return current;
      }
      const pages = [...current.pages];
      pages[currentIndex] = refreshed;
      return { ...current, pages };
    });
  } finally {
    if (requests.get(cursor) === request) requests.delete(cursor);
  }
}

export function refreshConversationPageWithNotice(queryClient: QueryClient, id: string): void {
  void refreshConversationPage(queryClient, id).catch((error: unknown) => {
    console.error('[agent] conversation page refresh failed', error);
    toast.error('会话列表刷新失败，请稍后重试。');
  });
}
