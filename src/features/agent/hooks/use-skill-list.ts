'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { skillsQueryOptions } from '../api/queries';
import type { SkillListItem } from '../api/types';
import { SKILL_IDS, SKILL_REGISTRY } from '../constants/skills';

/**
 * 预置技能兜底列表：合并查询（含用户自定义）返回前先渲染，保证预置技能即时可用、不闪空。
 * 形状与 skill-service 的 presetToListItem 一致（source='builtin'，tools null=全量，examples []=无）。
 */
const BUILTIN_FALLBACK: SkillListItem[] = SKILL_IDS.map((id) => {
  const entry = SKILL_REGISTRY[id];
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
});

/**
 * 合并技能列表（预置 + 用户自定义）客户端读取：会话选择器与输入区共用。
 *
 * 用 useQuery（非 suspense）：选择器/输入区常驻挂载，不应因技能列表挂起整个对话 UI；
 * 加载中或请求失败均回退预置列表（预置技能永远可用）。staleTime 60s + 共享 queryKey
 * （agentKeys.skills()）→ 多组件调用只发一次请求；技能增删改后按域失效自动刷新。
 */
export function useSkillList() {
  const { data } = useQuery(skillsQueryOptions());
  const skills = data?.skills ?? BUILTIN_FALLBACK;
  const byId = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  /** 按 id 解析技能（含自定义 uuid）；空/未命中 → undefined（调用方回退「通用」） */
  const getById = useCallback(
    (id?: string | null): SkillListItem | undefined => (id ? byId.get(id) : undefined),
    [byId]
  );
  return { skills, getById };
}
