import { isUuid } from '@/lib/utils';

export const CONVERSATIONS_PAGE_SIZE = 50;

export interface ConversationCursor {
  createdAt: string;
  id: string;
}

export function parseConversationCursor(value: string): ConversationCursor | null {
  const [createdAt, id, extra] = value.split('~');
  if (
    extra !== undefined ||
    !createdAt ||
    !id ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(createdAt) ||
    !isUuid(id)
  ) {
    return null;
  }
  const date = new Date(createdAt);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== createdAt.slice(0, 19)
  ) {
    return null;
  }
  return { createdAt, id };
}
