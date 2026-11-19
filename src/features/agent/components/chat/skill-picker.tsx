'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { SkillCatalogItem, SkillSelection } from '../../api/types';
import { useSkillCatalog } from '../../hooks/use-skill-catalog';

interface SkillPickerProps {
  /** 本条消息已选技能（null = 自动匹配） */
  value: SkillSelection | null;
  onSelect: (skill: SkillCatalogItem) => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * 技能选择器（工具条按钮 + 下拉目录）：为「下一条消息」指定技能，不绑定会话。
 *
 * 与旧的会话级 pill 的区别：选择只作用于下一条消息（发送后由 chat-window 清空），
 * 不写会话设置、不需要 settings 握手；不选时由 Agent 按目录描述自动 loadSkill。
 * 数据源为轻量目录（useSkillCatalog，不含正文），自定义技能带「自定义」标识，
 * 底部提供「管理技能…」入口跳转技能管理页。
 */
export function SkillPicker({ value, onSelect, onClear, disabled }: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { skills } = useSkillCatalog();

  // 每次打开重置搜索草稿
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return skills;
    return skills.filter(
      (entry) =>
        entry.name.toLowerCase().includes(keyword) ||
        entry.description.toLowerCase().includes(keyword)
    );
  }, [search, skills]);

  const handlePick = (skill: SkillCatalogItem) => {
    onSelect(skill);
    setOpen(false);
  };

  const handleAuto = () => {
    onClear();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label='选择本条消息的技能'
        aria-pressed={value !== null}
        title='为下一条消息指定技能；不指定则由 Agent 自动匹配'
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
          value
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-input bg-background text-muted-foreground hover:bg-muted/50'
        )}
      >
        <Icons.sparkles className='size-3.5 shrink-0' />
        {/* 窄屏只留图标，与「引用资产」按钮同策略 */}
        <span className='hidden sm:inline'>技能</span>
        <Icons.chevronDown className='size-3 shrink-0 opacity-60' />
      </PopoverTrigger>
      <PopoverContent align='start' side='top' className='w-80 gap-2'>
        <div className='relative'>
          <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='搜索技能…'
            aria-label='搜索技能'
            className='h-8 pl-8 text-xs'
          />
        </div>
        <div className='max-h-72 overflow-y-auto'>
          <button
            type='button'
            onClick={handleAuto}
            aria-pressed={value === null}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              value === null ? 'bg-muted font-medium' : 'hover:bg-muted/50'
            )}
          >
            <span className='min-w-0'>
              <span className='block font-medium'>自动匹配</span>
              <span className='text-muted-foreground mt-0.5 block'>
                不指定技能，由 Agent 按需加载合适的技能
              </span>
            </span>
            {value === null && <Icons.check className='size-3.5 shrink-0' />}
          </button>
          {filtered.map((entry) => {
            const active = value?.id === entry.id;
            return (
              <button
                key={entry.id}
                type='button'
                onClick={() => handlePick(entry)}
                aria-pressed={active}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  active ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                )}
              >
                <span className='min-w-0'>
                  <span className='flex items-center gap-1.5'>
                    <span className='truncate font-medium'>{entry.name}</span>
                    {entry.source === 'custom' && (
                      <Badge variant='secondary' className='h-4 shrink-0 px-1.5 text-[10px]'>
                        自定义
                      </Badge>
                    )}
                  </span>
                  <span className='text-muted-foreground mt-0.5 block'>{entry.description}</span>
                </span>
                {active && <Icons.check className='size-3.5 shrink-0' />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className='text-muted-foreground py-6 text-center text-xs'>
              没有匹配的技能，换个关键词试试。
            </div>
          )}
        </div>
        <p className='text-muted-foreground border-t pt-2 text-[11px] leading-relaxed'>
          技能只对下一条消息生效，发送后自动清除；不选则由 Agent 自动匹配。
        </p>
        <div className='border-t pt-1'>
          <Link
            href='/dashboard/skills'
            onClick={() => setOpen(false)}
            className={cn(
              'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              'focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs',
              'focus-visible:ring-2 focus-visible:outline-none'
            )}
          >
            <Icons.settings className='size-3.5 shrink-0' />
            管理技能…
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
