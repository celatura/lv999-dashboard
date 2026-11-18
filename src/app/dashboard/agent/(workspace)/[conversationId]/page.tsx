import { getUserId } from '@/lib/auth-session';
import { notFound } from 'next/navigation';
import { getConversation, listMessages } from '@/features/agent/api/service';
import type { AgentChatMessage } from '@/features/agent/api/types';
import { ChatWindow } from '@/features/agent/components/chat/chat-window';

export const metadata = {
  title: 'Dashboard: Agent 创作'
};

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({ params }: PageProps) {
  const userId = await getUserId();
  if (!userId) notFound();

  const { conversationId } = await params;
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) notFound();

  const messageRows = await listMessages(userId, conversationId);
  // DB 行由服务端写入（parts 即 UIMessage parts），收窄到共享聊天消息类型
  const initialMessages: AgentChatMessage[] = (messageRows ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts as AgentChatMessage['parts'],
    metadata: (message.metadata ?? undefined) as AgentChatMessage['metadata']
  }));

  return (
    <ChatWindow
      key={conversationId}
      conversation={conversation}
      initialMessages={initialMessages}
    />
  );
}
