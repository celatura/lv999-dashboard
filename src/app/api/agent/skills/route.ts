import { getUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import {
  createSkill,
  listSkillCatalogForUser,
  listSkillDetailsForUser,
  SkillNameConflictError
} from '@/features/agent/api/skill-service';
import { skillMutationSchema } from '@/features/agent/api/types';

export const runtime = 'nodejs';

/** 技能写入限流：30 次/分/用户（纯管理操作，防刷；不计费） */
const SKILLS_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * GET：默认返回轻量技能目录（不含正文），供输入区选择器/空态使用；
 * `?include=body` 返回完整内容，仅供技能管理页（编辑/复制为草稿）。
 */
export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const includeBody = new URL(request.url).searchParams.get('include') === 'body';
  const skills = includeBody
    ? await listSkillDetailsForUser(userId)
    : await listSkillCatalogForUser(userId);
  return Response.json({ skills });
}

/**
 * POST：创建自定义技能。限流 → 解析 → Zod 校验 → 名称唯一校验 → 落库 → 返回 { id }。
 * 校验失败返回通用英文信封（面向用户的中文提示由客户端表单校验给出，见 api-error.ts 约定）。
 */
export async function POST(request: Request) {
  const userId = await getUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
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

  try {
    const { id } = await createSkill(userId, parsed.data);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return apiError(409, 'skill_name_conflict', 'Skill name already exists');
    }
    throw error;
  }
}
