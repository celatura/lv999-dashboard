import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { PRESET_SKILLS, isReservedSkillName, type SkillRegistryEntry } from '../constants/skills';
import {
  toCatalogItem,
  type SkillCatalogItem,
  type SkillDetail,
  type SkillMutationPayload
} from './types';

/**
 * 技能数据访问层（server-only）。
 *
 * 技能 = 按需加载的专家工作流包：预置（代码内 SKILL_REGISTRY，只读）+ 用户自建（skills 表，
 * 按 userId 隔离）。两者映射为同一 SkillRegistryEntry，供 buildAgent 的目录、loadSkill 解析
 * 与「本条消息指定技能」共用，零重复实现。
 *
 * 读取分三档，避免把正文无谓地发给客户端：
 * - listSkillEntriesForUser：完整条目（服务端 Agent 用：目录 + loadSkill + 显式技能）
 * - listSkillCatalogForUser：轻量目录（客户端选择器/空态用）
 * - listSkillDetailsForUser：完整内容（技能管理页编辑/复制用）
 *
 * 顺序：路由目录与选择器为「自定义在前、预置兜底」，避免 MAX_CATALOG_SKILLS 截断时
 * 用户技能被预置示例挤掉；管理页保持预置在前，便于查看官方示例。
 *
 * id 命名空间天然区分来源：预置为字符串 key（'xiaohongshu' 等），自定义为 uuid。
 * 归属即权限：自定义技能读写一律按 userId 过滤，越权与不存在同样返回空（不泄漏存在性）。
 * loadSkill 先按 id、再按 name 查找，因此名称在「预置 + 当前用户自定义」范围内必须唯一。
 */

type SkillRow = typeof skills.$inferSelect;

/** 名称冲突（create/update）：Route Handler 转 409 skill_name_conflict */
export class SkillNameConflictError extends Error {
  constructor() {
    super('Skill name already exists');
    this.name = 'SkillNameConflictError';
  }
}

/** DB 行 → SkillRegistryEntry（供 buildAgent 复用目录/加载/工具边界；null 归一为 undefined） */
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

/** DB 行 → 轻量目录项 */
function rowToCatalog(row: SkillRow): SkillCatalogItem {
  return toCatalogItem(rowToEntry(row), 'custom', row.updatedAt.toISOString());
}

/** DB 行 → 完整内容（管理页） */
function rowToDetail(row: SkillRow): SkillDetail {
  return {
    ...rowToCatalog(row),
    instructions: row.instructions,
    tools: row.tools ?? null,
    examples: row.examples ?? []
  };
}

/** 预置技能 → 轻量目录项（source='builtin'，只读，无 updatedAt） */
function presetToCatalog(entry: SkillRegistryEntry): SkillCatalogItem {
  return toCatalogItem(entry, 'builtin', null);
}

/** 预置技能 → 完整内容（管理页「复制为草稿」用） */
function presetToDetail(entry: SkillRegistryEntry): SkillDetail {
  return {
    ...presetToCatalog(entry),
    instructions: entry.instructions,
    tools: entry.tools ? [...entry.tools] : null,
    examples: entry.examples ? [...entry.examples] : []
  };
}

/** 用户自定义技能行（按创建时间倒序；各读取档位自行决定与预置的拼接顺序） */
function listCustomRows(userId: string) {
  return getDb()
    .select()
    .from(skills)
    .where(eq(skills.userId, userId))
    .orderBy(desc(skills.createdAt));
}

/**
 * 服务端完整条目：自定义在前 + 预置兜底。
 * chat 路由每请求取一次，供 system 目录、loadSkill 解析与显式技能校验共用。
 */
export async function listSkillEntriesForUser(userId: string): Promise<SkillRegistryEntry[]> {
  const rows = await listCustomRows(userId);
  return [...rows.map(rowToEntry), ...PRESET_SKILLS];
}

/** 客户端轻量目录：选择器/空态只需名称、描述与引导语，不含正文 */
export async function listSkillCatalogForUser(userId: string): Promise<SkillCatalogItem[]> {
  const rows = await listCustomRows(userId);
  return [...rows.map(rowToCatalog), ...PRESET_SKILLS.map(presetToCatalog)];
}

/** 技能管理页：完整内容（编辑 / 复制为草稿 / 展示工具边界）；预置在前，作为官方示例区 */
export async function listSkillDetailsForUser(userId: string): Promise<SkillDetail[]> {
  const rows = await listCustomRows(userId);
  return [...PRESET_SKILLS.map(presetToDetail), ...rows.map(rowToDetail)];
}

/**
 * 名称可用性：预置 + 当前用户自定义内唯一（不区分大小写与首尾空白）。
 * loadSkill 先按 id、再按名称解析；名称重名或等于预置 id 会让模型加载到不可预期的技能，
 * 因此在写入时拦截。
 */
async function assertSkillNameAvailable(
  userId: string,
  name: string,
  excludeId?: string
): Promise<void> {
  const normalized = name.trim().toLocaleLowerCase();
  if (isReservedSkillName(name)) {
    throw new SkillNameConflictError();
  }
  const rows = await getDb()
    .select({ name: skills.name })
    .from(skills)
    .where(and(eq(skills.userId, userId), excludeId ? ne(skills.id, excludeId) : undefined));
  if (rows.some((row) => row.name.trim().toLocaleLowerCase() === normalized)) {
    throw new SkillNameConflictError();
  }
}

/** 创建自定义技能，返回新技能 id（uuid）。名称冲突 → SkillNameConflictError。 */
export async function createSkill(
  userId: string,
  payload: SkillMutationPayload
): Promise<{ id: string }> {
  await assertSkillNameAvailable(userId, payload.name);
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
 * 更新自定义技能（Route Handler 已保证 id 为 uuid）：先确认归属（越权/不存在 → null → 404），
 * 再校验名称唯一（排除自身），最后按 userId 归属更新。
 */
export async function updateSkill(
  userId: string,
  id: string,
  payload: SkillMutationPayload
): Promise<SkillDetail | null> {
  const db = getDb();
  const existing = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.id, id), eq(skills.userId, userId)))
    .limit(1);
  if (!existing[0]) return null;
  await assertSkillNameAvailable(userId, payload.name, id);
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
  return rows[0] ? rowToDetail(rows[0]) : null;
}

/**
 * 删除自定义技能（uuid + 归属）。
 * 消息里的技能引用（metadata.skillId / loadSkill 历史）保留但不再解析，界面按名称展示、
 * 后续不可再选择；不触碰历史消息（已发送内容不被篡改）。
 */
export async function deleteSkill(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(skills)
    .where(and(eq(skills.id, id), eq(skills.userId, userId)))
    .returning({ id: skills.id });
  return deleted.length > 0;
}
