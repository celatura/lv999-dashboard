import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { deleteSkill, updateSkill } from '@/features/agent/api/skill-service';
import { skillMutationSchema } from '@/features/agent/api/types';

export const runtime = 'nodejs';

/** 技能写入限流：30 次/分/用户（与 POST 同 scope，共享窗口） */
const SKILLS_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH：更新自定义技能。仅 uuid 可改——预置 key（非 uuid）→ 404（预置只读，不泄漏存在性）；
 * uuid 的归属过滤在 updateSkill 内完成，越权/不存在 → 404。
 */
export async function PATCH(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Skill not found');
  }

  const [allowed, rawJson] = await Promise.all([
    checkRateLimit('skills', userId, SKILLS_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.json().catch(() => undefined)
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  if (rawJson === undefined) {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = skillMutationSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid skill');
  }

  const updated = await updateSkill(userId, id, parsed.data);
  if (!updated) {
    return apiError(404, 'not_found', 'Skill not found');
  }
  return Response.json({ success: true });
}

/**
 * DELETE：删除自定义技能（仅 uuid + 归属）。deleteSkill 内同时把引用它的会话
 * activeSkillId 置 null（显式回退通用）。预置 key → 404；越权/不存在 → 404。
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Skill not found');
  }

  const allowed = await checkRateLimit(
    'skills',
    userId,
    SKILLS_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  const deleted = await deleteSkill(userId, id);
  if (!deleted) {
    return apiError(404, 'not_found', 'Skill not found');
  }
  return Response.json({ success: true });
}
