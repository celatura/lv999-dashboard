'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { skillsQueryOptions } from '../api/queries';
import type { SkillCatalogItem } from '../api/types';

/** 稳定空引用：查询未返回时避免每次渲染新建数组、击穿 useMemo */
const EMPTY_SKILLS: SkillCatalogItem[] = [];

/**
 * 轻量技能目录（skills 表，按用户隔离）：输入区选择器、空态推荐与占位符解析共用。
 * 只取 id/name/description/placeholder，不含技能正文——聊天页不再为一个小按钮下载全部技能全文。
 *
 * 用 useQuery（非 suspense）：选择器/输入区常驻挂载，不应因技能目录挂起整个对话 UI。
 * 查询未返回时为空列表（技能只来自用户自建，没有代码内兜底）；isError 用于区分「请求失败」
 * 与「真的没有技能」，避免把故障误报成空态。staleTime 60s + 共享 queryKey
 * （agentKeys.skills()）→ 多组件调用只发一次请求；技能增删改后按 skillsRoot 失效自动刷新。
 */
export function useSkillCatalog() {
  const { data, isPending, isError } = useQuery(skillsQueryOptions());
  const skills = data?.skills ?? EMPTY_SKILLS;
  const byId = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  /** 按 id 解析技能目录项；空/未命中 → undefined（调用方回退通用文案） */
  const getById = useCallback(
    (id?: string | null): SkillCatalogItem | undefined => (id ? byId.get(id) : undefined),
    [byId]
  );
  return { skills, getById, isLoading: isPending, isError };
}
