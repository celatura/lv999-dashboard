'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import type { Column, ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { DataTableFeatures } from '@/lib/data-table';
import { setAssetFavoriteMutation } from '../../../api/mutations';
import { ASSET_KIND_META, ASSET_KINDS, getAssetKindMeta } from '../../../constants/kinds';
import { assetThumbUrl } from '../../../lib/asset-url';
import type { Asset } from '../../../api/types';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { CellAction } from './cell-action';

/**
 * 预览弹窗含完整 Markdown 渲染链（streamdown 约 99KB 未压缩），按需加载：
 * 不打开预览则不下载该 chunk（bundle-dynamic-imports）。
 */
const AssetPreviewDialog = dynamic(
  () => import('../asset-preview-dialog').then((m) => m.AssetPreviewDialog),
  { ssr: false }
);

/** AI 整版产出、尚未在画布保存的 design：无预览 PNG（预览由保存时客户端导出） */
function isPreviewlessDesign(asset: Asset): boolean {
  return asset.kind === 'design' && !asset.hasPreview;
}

/** 标题单元格：类型缩略图 + 标题，点击打开预览弹窗（资产视角，不再深链到来源会话） */
function AssetTitleCell({ asset }: { asset: Asset }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMounted, setPreviewMounted] = useState(false);
  // 无预览的 design 弹窗里无图可看，改为直接进画布（保存后自动生成预览）
  const openInEditor = isPreviewlessDesign(asset);

  // 首次打开后才挂载（挂载即触发 chunk 加载）；之后保持挂载以保留关闭动画
  const openPreview = () => {
    setPreviewMounted(true);
    setPreviewOpen(true);
  };

  const inner = (
    <>
      <AssetThumb asset={asset} />
      <span className='min-w-0'>
        <span className='block truncate font-medium group-hover:underline'>{asset.title}</span>
        {openInEditor && (
          <span className='text-muted-foreground block truncate text-xs'>
            AI 整版 · 打开编辑生成预览
          </span>
        )}
      </span>
    </>
  );

  if (openInEditor) {
    return (
      <Link
        href={`/dashboard/design/${asset.id}`}
        className='group flex min-w-0 items-center gap-3 text-left'
      >
        {inner}
      </Link>
    );
  }

  return (
    <>
      <button
        type='button'
        onClick={openPreview}
        className='group flex min-w-0 items-center gap-3 text-left'
      >
        {inner}
      </button>
      {previewMounted && (
        <AssetPreviewDialog assetId={asset.id} open={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </>
  );
}

/**
 * 行首缩略图：图片/设计资产经同源 /raw 代理加载 36px 预览（设计取导出 PNG），
 * 视频资产经 /raw?snapshot=1 加载 OSS 截帧封面 + 播放图标 overlay（列表不渲染 <video>，
 * 避免 10+ 视频并发预加载阻塞页面）；文本类资产与加载失败回退为类型图标 tile；
 * 无预览的 design（AI 整版首轮）直接走占位 tile，不发必然 404 的 /raw 请求；
 * 图片/设计缩略图走 `?thumb=1`（OSS 等比缩放）+ 版本参数，不拉原图（见 lib/asset-url.ts）；
 * bg-muted 兼作暗色下透明图底色。
 */
function AssetThumb({ asset }: { asset: Asset }) {
  const [failed, setFailed] = useState(false);
  const { icon: KindIcon } = getAssetKindMeta(asset.kind);
  const isVideo = asset.kind === 'video';
  const placeholder = isPreviewlessDesign(asset);
  const isVisual =
    !placeholder && (asset.kind === 'image' || asset.kind === 'design' || isVideo) && !failed;

  if (!isVisual) {
    return (
      <span
        className={cn(
          'bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md',
          placeholder && 'border-border border border-dashed bg-transparent'
        )}
      >
        <KindIcon className='size-4' />
      </span>
    );
  }
  // 视频走截帧封面（?snapshot=1）；图片/设计走 OSS 缩放后的缩略图
  const src = isVideo ? `/api/agent/assets/${asset.id}/raw?snapshot=1` : assetThumbUrl(asset);
  return (
    <span className='relative size-9 shrink-0'>
      {
        // oxlint-disable-next-line nextjs/no-img-element -- 同源 /raw 代理缩略图（视频为 OSS 截帧封面），不经图片优化器
        <img
          src={src}
          alt=''
          loading='lazy'
          onError={() => setFailed(true)}
          className='bg-muted border-border/60 size-9 rounded-md border object-cover'
        />
      }
      {isVideo && (
        <span className='bg-background/70 absolute inset-0 flex items-center justify-center rounded-md'>
          <Icons.play className='text-foreground size-4' />
        </span>
      )}
    </span>
  );
}

/** 行内收藏切换：星形图标按钮，乐观失效走 assetsRoot（列表重查后回填真实状态） */
function FavoriteCell({ asset }: { asset: Asset }) {
  const mutation = useMutation(setAssetFavoriteMutation);
  return (
    <button
      type='button'
      aria-label={asset.favorite ? '取消收藏' : '收藏'}
      aria-pressed={asset.favorite}
      disabled={mutation.isPending}
      onClick={() =>
        mutation.mutate(
          { id: asset.id, favorite: !asset.favorite },
          {
            onSuccess: () => toast.success(asset.favorite ? '已取消收藏' : '已收藏'),
            onError: () => toast.error('操作失败，请稍后重试')
          }
        )
      }
      className={cn(
        'text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-50',
        asset.favorite && 'text-amber-500 hover:text-amber-500'
      )}
    >
      <Icons.star className={cn('size-4', asset.favorite && 'fill-current')} />
    </button>
  );
}

export const columns: ColumnDef<DataTableFeatures, Asset>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        aria-label='全选'
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label='选择行'
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
      />
    ),
    enableSorting: false,
    enableHiding: false
  },
  {
    id: 'title',
    accessorKey: 'title',
    header: ({ column }: { column: Column<DataTableFeatures, Asset, unknown> }) => (
      <DataTableColumnHeader column={column} title='标题' />
    ),
    cell: ({ row }) => <AssetTitleCell asset={row.original} />,
    meta: {
      label: '标题',
      placeholder: '搜索资产标题...',
      variant: 'text' as const,
      icon: Icons.text
    },
    enableColumnFilter: true
  },
  {
    id: 'kind',
    accessorKey: 'kind',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, Asset, unknown> }) => (
      <DataTableColumnHeader column={column} title='类型' />
    ),
    cell: ({ row }) => {
      const { label, icon: KindIcon } = getAssetKindMeta(row.original.kind);
      return (
        <Badge variant='outline'>
          <KindIcon className='size-3' />
          {label}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: '类型',
      variant: 'multiSelect' as const,
      options: ASSET_KINDS.map((kind) => ({
        label: ASSET_KIND_META[kind].label,
        value: kind
      }))
    }
  },
  {
    id: 'sizeBytes',
    accessorKey: 'sizeBytes',
    header: ({ column }: { column: Column<DataTableFeatures, Asset, unknown> }) => (
      <DataTableColumnHeader column={column} title='大小' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {formatBytes(row.original.sizeBytes ?? 0)}
      </span>
    ),
    meta: {
      label: '大小'
    }
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }: { column: Column<DataTableFeatures, Asset, unknown> }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
    meta: {
      label: '创建时间'
    }
  },
  {
    id: 'favorite',
    accessorKey: 'favorite',
    enableSorting: false,
    /** 紧凑固定列：图标贴右缘成组，避免宽列内悬浮感 */
    size: 48,
    header: () => <span className='sr-only'>收藏</span>,
    cell: ({ row }) => (
      <div className='flex justify-center'>
        <FavoriteCell asset={row.original} />
      </div>
    ),
    enableHiding: false
  },
  {
    id: 'actions',
    size: 48,
    cell: ({ row }) => (
      <div className='flex justify-center'>
        <CellAction data={row.original} />
      </div>
    )
  }
];
