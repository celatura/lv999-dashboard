'use client';

import { useState } from 'react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { getAssetKindMeta } from '../../constants/kinds';
import { downloadAsset } from '../../lib/asset-download';
import { imageThumbnailUrl } from '../../lib/asset-url';
import { formatBytes } from '../../lib/format';
import type { AssetKind } from '../../api/types';

/** 按需加载：不打开预览则不下载含 streamdown 的弹窗 chunk（bundle-dynamic-imports） */
const AssetPreviewDialog = dynamic(
  () => import('./asset-preview-dialog').then((m) => m.AssetPreviewDialog),
  { ssr: false }
);

interface AssetCardProps {
  assetId: string;
  title: string;
  kind: AssetKind;
  sizeBytes?: number | null;
}

/**
 * 对话内联的资产卡片：预览 + 下载。
 * - image 资产：顶部渲染内联缩略图（`?thumb=1`，OSS 等比缩放到 320w）——生成结果立即可见，
 *   点击缩略图或「预览」打开原图；缩略图加载失败时回退为图标行布局。
 * - 文本资产（markdown/html）：保持紧凑的图标行布局，不渲染缩略图。
 */
export function AssetCard({ assetId, title, kind, sizeBytes }: AssetCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMounted, setPreviewMounted] = useState(false);
  // 缩略图 404 / 处理失败 → 回退图标布局（raw 路由已对 OSS 处理失败做原图回退）
  const [thumbFailed, setThumbFailed] = useState(false);
  const { label, icon: KindIcon } = getAssetKindMeta(kind);
  const showThumbnail = kind === 'image' && !thumbFailed;

  // 首次打开后才挂载（挂载即触发 chunk 加载）；之后保持挂载以保留关闭动画
  const openPreview = () => {
    setPreviewMounted(true);
    setPreviewOpen(true);
  };

  return (
    <>
      <div
        className={cn('bg-card overflow-hidden rounded-xl border', kind === 'image' && 'max-w-md')}
      >
        {showThumbnail && (
          <button
            type='button'
            onClick={openPreview}
            aria-label={`预览图片：${title}`}
            className='group bg-muted/50 relative block h-60 w-full cursor-zoom-in focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] focus-visible:outline-none sm:h-72'
          >
            <Image
              src={imageThumbnailUrl(assetId)}
              alt={title}
              fill
              unoptimized
              loading='lazy'
              onError={() => setThumbFailed(true)}
              className='object-contain'
            />
            <span
              aria-hidden
              className='absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-focus-visible:bg-black/25 group-focus-visible:opacity-100 group-hover:bg-black/25 group-hover:opacity-100'
            >
              <span className='bg-background/90 text-foreground flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm'>
                <Icons.eye className='size-3.5' /> 预览
              </span>
            </span>
          </button>
        )}
        <div className='flex items-center gap-3 p-3'>
          {!showThumbnail && (
            <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
              <KindIcon className='size-4' />
            </div>
          )}
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-medium'>{title}</p>
            {(kind !== 'image' || typeof sizeBytes === 'number') && (
              <div className='text-muted-foreground mt-1 flex items-center gap-2 text-xs'>
                {/* 图片卡已由缩略图传达类型，徽章冗余；文本资产保留类型徽章 */}
                {kind !== 'image' && <Badge variant='outline'>{label}</Badge>}
                {typeof sizeBytes === 'number' && <span>{formatBytes(sizeBytes)}</span>}
              </div>
            )}
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <button
              type='button'
              onClick={openPreview}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Icons.eye /> 预览
            </button>
            <button
              type='button'
              onClick={() => void downloadAsset(assetId)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <Icons.download /> 下载
            </button>
          </div>
        </div>
      </div>
      {previewMounted && (
        <AssetPreviewDialog assetId={assetId} open={previewOpen} onOpenChange={setPreviewOpen} />
      )}
    </>
  );
}
