'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { cn } from '@/lib/utils';
import { assetsQueryOptions } from '../../api/queries';
import { getAssetKindMeta } from '../../constants/kinds';
import { formatDateTime } from '../../lib/format';
import type { ReferencedAsset } from '../../lib/asset-reference';

/** 可被对话引用的类型（design 为结构化文档、正文不可读，本期排除） */
const REFERENCEABLE_KINDS = 'markdown,html,image';

const KIND_FILTERS = [
  { value: 'all', label: '全部', kind: REFERENCEABLE_KINDS },
  { value: 'image', label: '图片', kind: 'image' },
  { value: 'markdown', label: 'Markdown', kind: 'markdown' },
  { value: 'html', label: 'HTML', kind: 'html' }
] as const;

type KindFilterValue = (typeof KIND_FILTERS)[number]['value'];

/** 单次拉取上限：引用场景只需最近的一批资产，超出可用搜索缩小范围 */
const PAGE_LIMIT = 40;

interface AssetReferencePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 已在输入区引用的资产 id：列表内置灰，避免重复添加 */
  referencedIds: string[];
  onPick: (asset: ReferencedAsset) => void;
}

/**
 * 对话内「引用资产」选择器：从「我的资产」中挑选要交给 Agent 复用的作品。
 * 复用 assetsQueryOptions（与资产页同一缓存域），支持类型过滤 + 标题搜索（防抖）；
 * 多选后一次性回传，由输入区展示为可移除的引用 chip。
 */
export function AssetReferencePicker({
  open,
  onOpenChange,
  referencedIds,
  onPick
}: AssetReferencePickerProps) {
  const [filter, setFilter] = useState<KindFilterValue>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReferencedAsset[]>([]);

  const debouncedSetSearch = useDebouncedCallback((value: string) => {
    setSearch(value.trim());
  }, 300);

  // 每次打开重置筛选与勾选（关闭即丢弃上次草稿）
  useEffect(() => {
    if (!open) return;
    setFilter('all');
    setSearchInput('');
    setSearch('');
    setSelected([]);
  }, [open]);

  const kind = KIND_FILTERS.find((item) => item.value === filter)?.kind ?? REFERENCEABLE_KINDS;
  const { data, isLoading, isError } = useQuery({
    ...assetsQueryOptions({ kind, page: 1, limit: PAGE_LIMIT, ...(search && { search }) }),
    enabled: open,
    // 搜索/切换类型时保留上一次结果，避免列表闪空
    placeholderData: keepPreviousData
  });
  const assets = data?.assets ?? [];
  // 渲染逐项查表：Set 化避免每行在 referencedIds / selected 里线性扫描
  const referencedIdSet = useMemo(() => new Set(referencedIds), [referencedIds]);
  const selectedIdSet = useMemo(() => new Set(selected.map((item) => item.id)), [selected]);

  const toggleSelect = (asset: ReferencedAsset) => {
    setSelected((prev) =>
      prev.some((item) => item.id === asset.id)
        ? prev.filter((item) => item.id !== asset.id)
        : [...prev, asset]
    );
  };

  const handleConfirm = () => {
    for (const asset of selected) {
      onPick(asset);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>引用资产</DialogTitle>
          <DialogDescription>
            选择要让 Agent 复用的作品：图片可继续修改，但 Agent 无法直接看到图片内容；
            文案可用于改写扩写。
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative min-w-0 flex-1'>
              <Icons.search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={searchInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearchInput(value);
                  debouncedSetSearch(value);
                }}
                placeholder='按标题搜索…'
                className='pl-8'
                aria-label='搜索资产标题'
              />
            </div>
            <div className='flex shrink-0 items-center gap-1'>
              {KIND_FILTERS.map((item) => (
                <Button
                  key={item.value}
                  type='button'
                  variant={filter === item.value ? 'default' : 'outline'}
                  size='sm'
                  className='h-8'
                  aria-pressed={filter === item.value}
                  onClick={() => setFilter(item.value)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div className='max-h-[50svh] min-h-40 overflow-y-auto'>
            {isLoading ? (
              <div className='text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm'>
                <Icons.spinner className='animate-spin' /> 加载中…
              </div>
            ) : isError ? (
              <div className='text-destructive py-12 text-center text-sm'>
                加载资产失败，请稍后重试。
              </div>
            ) : assets.length === 0 ? (
              <div className='text-muted-foreground py-12 text-center text-sm'>
                {search ? '没有匹配的资产，换个关键词试试。' : '还没有可引用的资产。'}
              </div>
            ) : (
              <ul className='flex flex-col gap-1.5'>
                {assets.map((asset) => {
                  const { label, icon: KindIcon } = getAssetKindMeta(asset.kind);
                  const alreadyReferenced = referencedIdSet.has(asset.id);
                  const isSelected = selectedIdSet.has(asset.id);
                  return (
                    <li key={asset.id}>
                      <button
                        type='button'
                        disabled={alreadyReferenced}
                        aria-pressed={isSelected}
                        onClick={() =>
                          toggleSelect({ id: asset.id, title: asset.title, kind: asset.kind })
                        }
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                          alreadyReferenced
                            ? 'border-border/60 cursor-not-allowed opacity-50'
                            : isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/60 hover:bg-muted/50'
                        )}
                      >
                        <span className='bg-muted flex size-8 shrink-0 items-center justify-center rounded-md'>
                          <KindIcon className='size-4' />
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block truncate text-sm font-medium'>{asset.title}</span>
                          <span className='text-muted-foreground mt-0.5 block text-xs'>
                            {formatDateTime(asset.createdAt)}
                          </span>
                        </span>
                        {alreadyReferenced ? (
                          <Badge variant='outline'>已引用</Badge>
                        ) : (
                          <>
                            <Badge variant='outline'>{label}</Badge>
                            <span
                              className={cn(
                                'flex size-5 shrink-0 items-center justify-center rounded-full border',
                                isSelected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-border'
                              )}
                            >
                              {isSelected && <Icons.check className='size-3.5' />}
                            </span>
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={selected.length === 0}>
            {selected.length > 0 ? `添加所选 ${selected.length} 项` : '添加所选'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
