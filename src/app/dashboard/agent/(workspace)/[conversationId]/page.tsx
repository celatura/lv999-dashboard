import { requireUserId } from '@/lib/auth-session';
import { notFound } from 'next/navigation';
import type { UIMessage } from 'ai';
import { getConversation, listMessages } from '@/features/agent/api/service';
import { ChatWindow } from '@/features/agent/components/chat/chat-window';

export const metadata = {
  title: 'Dashboard: Agent 创作'
};

type PageProps = {
  params: Promise<{ conversationId: string }>;
};

export default async function ConversationPage({ params }: PageProps) {
  const userId = await requireUserId();
  if (!userId) notFound();

  const { conversationId } = await params;
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) notFound();

  const messageRows = await listMessages(userId, conversationId);
  const initialMessages: UIMessage[] = (messageRows ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    metadata: message.metadata ?? undefined
  }));

  return (
    <ChatWindow
      key={conversationId}
      conversation={conversation}
      initialMessages={initialMessages}
    />
  );
}
