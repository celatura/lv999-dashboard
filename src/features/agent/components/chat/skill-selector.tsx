'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useSkillList } from '../../hooks/use-skill-list';

interface SkillSelectorProps {
  /** 当前技能 id（null = 通用；预置 key 或自定义 uuid） */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

/**
 * 技能选择器：输入区一枚 pill（当前技能名或「通用」）+ 下拉列表（搜索 + 名称 + 何时用）。
 * 与模型选择器同构：选中即回调持久化（会话级）；激活后 pill 带 ✕ 一键清除回「通用」。
 * 数据源为合并列表（预置 + 用户自定义，见 useSkillList）；自定义技能带「自定义」标识，
 * 底部提供「管理技能…」入口跳转技能管理页。
 */
export function SkillSelector({ value, onChange, disabled }: SkillSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { skills, getById } = useSkillList();
  const skill = getById(value);

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

  const handlePick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className='flex min-w-0 items-center gap-1'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={disabled}
          title='为这段会话选定一个专家技能，Agent 将按其人设与工作流持续协作'
          className={cn(
            'flex h-8 min-w-0 shrink items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
            skill
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-input bg-background text-muted-foreground hover:bg-muted/50'
          )}
        >
          <Icons.sparkles className='size-3.5 shrink-0' />
          {/* 窄屏只留图标，与「引用资产」按钮同策略 */}
          <span className='max-w-24 truncate sm:max-w-40'>{skill ? skill.name : '通用'}</span>
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
              onClick={() => handlePick(null)}
              aria-pressed={skill === undefined}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                skill === undefined ? 'bg-muted font-medium' : 'hover:bg-muted/50'
              )}
            >
              <span className='min-w-0'>
                <span className='block font-medium'>通用</span>
                <span className='text-muted-foreground mt-0.5 block'>
                  不启用专家模式，按默认 Agent 协作
                </span>
              </span>
              {skill === undefined && <Icons.check className='size-3.5 shrink-0' />}
            </button>
            {filtered.map((entry) => {
              const active = value === entry.id;
              return (
                <button
                  key={entry.id}
                  type='button'
                  onClick={() => handlePick(entry.id)}
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
      {/* 激活态一键清除回「通用」（独立于下拉，点 ✕ 不必打开列表） */}
      {skill && (
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground size-6 shrink-0 rounded-full p-0'
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={`清除技能：${skill.name}`}
          title='清除技能，回到通用模式'
        >
          <Icons.close className='size-3.5' />
        </Button>
      )}
    </div>
  );
}
