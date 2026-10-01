import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { conversations, skills } from '@/lib/db/schema';
import { isUuid } from '@/lib/utils';
import { SKILL_IDS, SKILL_REGISTRY, getSkill, type SkillRegistryEntry } from '../constants/skills';
import type { SkillListItem, SkillMutationPayload } from './types';

/**
 * 自定义技能数据访问层（server-only）。
 *
 * 技能系统 2.0：把「专家模式」从代码内预置技能扩展为用户可自建技能。自定义技能存 skills 表
 * （按 userId 隔离），与代码内预置技能（SKILL_REGISTRY 常量）同构——解析后统一映射为
 * SkillRegistryEntry，复用 buildAgent 的指令注入 + 工具白名单过滤（零重复实现）。
 *
 * id 命名空间天然区分来源：预置为字符串 key（'xiaohongshu' 等），自定义为 uuid →
 * isUuid 分流「查 DB / 查常量」，无需额外标记列。归属即权限：自定义技能读写一律按 userId 过滤，
 * 越权与不存在同样返回空（不泄漏存在性）。客户端经 /api/agent/skills* Route Handler 取数，不直接引用本文件。
 */

type SkillRow = typeof skills.$inferSelect;

/** DB 行 → SkillRegistryEntry（供 buildAgent 复用指令注入 + 工具白名单过滤；null 归一为 undefined） */
function rowToEntry(row: SkillRow): SkillRegistryEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    placeholder: row.placeholder ?? undefined,
    tools: row.tools ?? undefined,
    examples: row.examples ?? undefined
  };
}

/** DB 行 → SkillListItem（source='custom'，供 selector / 管理页） */
function rowToListItem(row: SkillRow): SkillListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: 'custom',
    instructions: row.instructions,
    placeholder: row.placeholder ?? null,
    tools: row.tools ?? null,
    examples: row.examples ?? [],
    updatedAt: row.updatedAt.toISOString()
  };
}

/** 预置技能 → SkillListItem（source='builtin'，只读，无 updatedAt） */
function presetToListItem(entry: SkillRegistryEntry): SkillListItem {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: 'builtin',
    instructions: entry.instructions,
    placeholder: entry.placeholder ?? null,
    tools: entry.tools ? [...entry.tools] : null,
    examples: entry.examples ? [...entry.examples] : [],
    updatedAt: null
  };
}

/**
 * 会话技能解析（buildAgent 前置）：
 * - uuid → 查 DB（userId 归属过滤）映射为 SkillRegistryEntry；越权/已删除 → undefined
 * - 非 uuid → 查预置常量 getSkill（含非法/已下架 id → undefined）
 * - 空 → undefined
 * 返回 undefined 时 buildAgent 回退基础指令 + 全量工具（防御已有，不报错）。
 * 预置技能命中时不触库（同步常量读），仅自定义技能产生一次归属查询。
 */
export async function getSkillForUser(
  userId: string,
  skillId?: string | null
): Promise<SkillRegistryEntry | undefined> {
  if (!skillId) return undefined;
  if (!isUuid(skillId)) return getSkill(skillId);
  const db = getDb();
  const rows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.userId, userId)))
    .limit(1);
  return rows[0] ? rowToEntry(rows[0]) : undefined;
}

/**
 * 合并列表：预置（source='builtin'，按 SKILL_IDS 顺序）在前 + 用户自定义（source='custom'，
 * 按创建时间倒序）在后，一次返回供 selector / 管理页共用。
 */
export async function listSkillsForUser(userId: string): Promise<SkillListItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.userId, userId))
    .orderBy(desc(skills.createdAt));
  const builtin = SKILL_IDS.map((id) => presetToListItem(SKILL_REGISTRY[id]));
  return [...builtin, ...rows.map(rowToListItem)];
}

/** 创建自定义技能，返回新技能 id（uuid）。 */
export async function createSkill(
  userId: string,
  payload: SkillMutationPayload
): Promise<{ id: string }> {
  const db = getDb();
  const [row] = await db
    .insert(skills)
    .values({
      userId,
      name: payload.name,
      description: payload.description,
      instructions: payload.instructions,
      placeholder: payload.placeholder ?? null,
      tools: payload.tools ?? null,
      examples: payload.examples?.length ? payload.examples : null
    })
    .returning({ id: skills.id });
  return { id: row.id };
}

/**
 * 更新自定义技能（Route Handler 已保证 id 为 uuid）；where 带 userId 归属过滤。
 * 命中返回更新后的 SkillListItem；越权/不存在返回 null（Route Handler → 404）。
 */
export async function updateSkill(
  userId: string,
  id: string,
  payload: SkillMutationPayload
): Promise<SkillListItem | null> {
  const db = getDb();
  const rows = await db
    .update(skills)
    .set({
      name: payload.name,
      description: payload.description,
      instructions: payload.instructions,
      placeholder: payload.placeholder ?? null,
      tools: payload.tools ?? null,
      examples: payload.examples?.length ? payload.examples : null,
      updatedAt: new Date()
    })
    .where(and(eq(skills.id, id), eq(skills.userId, userId)))
    .returning();
  return rows[0] ? rowToListItem(rows[0]) : null;
}

/**
 * 删除自定义技能（uuid + 归属），并把引用它的会话 activeSkillId 置 null（显式回退通用）。
 * 返回是否删除了技能行；越权/不存在/预置 key（DB 无此行）→ false（Route Handler → 404）。
 * 双保险：即便漏置 activeSkillId，getSkillForUser 查不到也回退基础指令。
 */
export async function deleteSkill(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(skills)
    .where(and(eq(skills.id, id), eq(skills.userId, userId)))
    .returning({ id: skills.id });
  if (deleted.length === 0) return false;
  await db
    .update(conversations)
    .set({ activeSkillId: null })
    .where(and(eq(conversations.userId, userId), eq(conversations.activeSkillId, id)));
  return true;
}
