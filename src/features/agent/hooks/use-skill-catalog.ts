'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { skillsQueryOptions } from '../api/queries';
import type { SkillCatalogItem } from '../api/types';
import { SKILL_IDS, SKILL_REGISTRY } from '../constants/skills';

/**
 * 预置技能兜底目录：合并查询返回前先渲染，保证预置技能即时可用、不闪空。
 * 形状与 skill-service 的 presetToCatalog 一致（source='builtin'，无 updatedAt）。
 */
const BUILTIN_FALLBACK: SkillCatalogItem[] = SKILL_IDS.map((id) => {
  const entry = SKILL_REGISTRY[id];
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: 'builtin',
    placeholder: entry.placeholder ?? null,
    updatedAt: null
  };
});

/**
 * 轻量技能目录（预置 + 用户自定义）：输入区选择器、空态推荐与占位符解析共用。
 * 只取 id/name/description/placeholder，不含技能正文——聊天页不再为一个小按钮下载全部技能全文。
 *
 * 用 useQuery（非 suspense）：选择器/输入区常驻挂载，不应因技能目录挂起整个对话 UI；
 * 加载中或请求失败均回退预置列表（预置技能永远可用）。staleTime 60s + 共享 queryKey
 * （agentKeys.skills()）→ 多组件调用只发一次请求；技能增删改后按 skillsRoot 失效自动刷新。
 */
export function useSkillCatalog() {
  const { data } = useQuery(skillsQueryOptions());
  const skills = data?.skills ?? BUILTIN_FALLBACK;
  const byId = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  /** 按 id 解析技能目录项；空/未命中 → undefined（调用方回退通用文案） */
  const getById = useCallback(
    (id?: string | null): SkillCatalogItem | undefined => (id ? byId.get(id) : undefined),
    [byId]
  );
  return { skills, getById };
}
