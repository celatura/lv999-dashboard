import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import {
  deleteConversation,
  getConversation,
  updateConversation
} from '@/features/agent/api/service';
import { isModelKey } from '@/features/agent/constants/models';
import { isSkillReference } from '@/features/agent/constants/skills';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  const conversation = await getConversation(userId, id);
  if (!conversation) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  return Response.json(conversation);
}

export async function PATCH(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Conversation not found');
  }

  let body: { title?: unknown; model?: unknown; activeSkillId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const patch: { title?: string; model?: string; activeSkillId?: string | null } = {};
  if (typeof body.title === 'string') {
    const title = body.title.trim();
    if (title.length < 1 || title.length > 100) {
      return apiError(400, 'invalid_request', 'title must be 1-100 characters');
    }
    patch.title = title;
  }
  if (body.model !== undefined) {
    if (!isModelKey(body.model)) {
      return apiError(400, 'invalid_request', 'Unknown model key');
    }
    patch.model = body.model;
  }
  // 技能切换：null = 清除回「通用」；字符串必须是预置 key 或自定义技能 uuid
  if (body.activeSkillId !== undefined) {
    if (body.activeSkillId === null) {
      patch.activeSkillId = null;
    } else if (isSkillReference(body.activeSkillId)) {
      patch.activeSkillId = body.activeSkillId;
    } else {
      return apiError(400, 'invalid_request', 'Unknown skill id');
    }
  }
  if (Object.keys(patch).length === 0) {
    return apiError(400, 'invalid_request', 'Nothing to update');
  }

  const conversation = await updateConversation(userId, id, patch);
  if (!conversation) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  return Response.json(conversation);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  const deleted = await deleteConversation(userId, id);
  if (!deleted) {
    return apiError(404, 'not_found', 'Conversation not found');
  }
  return Response.json({ success: true });
}
