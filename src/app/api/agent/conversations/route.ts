import { getUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { createConversation, listConversations } from '@/features/agent/api/service';
import { DEFAULT_MODEL, isModelKey } from '@/features/agent/constants/models';
import { parseConversationCursor } from '@/features/agent/lib/conversation-pagination';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const value = new URL(request.url).searchParams.get('cursor');
  const cursor = value === null ? null : parseConversationCursor(value);
  if (value !== null && !cursor) return apiError(400, 'invalid_request', 'Invalid cursor');
  const result = await listConversations(userId, cursor);
  return Response.json(result);
}

export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  let body: { model?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const model = isModelKey(body.model) ? body.model : DEFAULT_MODEL;
  const conversation = await createConversation(userId, model);
  return Response.json(conversation, { status: 201 });
}
