'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Icons } from '@/components/icons';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { getAssetKindMeta } from '../../constants/kinds';
import { assetQueryOptions } from '../../api/queries';
import { downloadAsset } from '../../lib/asset-download';
import { formatBytes } from '../../lib/format';
import { STREAMDOWN_PLUGINS } from '../../lib/streamdown-plugins';
import { CopyButton } from '../copy-button';

interface AssetPreviewDialogProps {
  assetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 资产预览弹窗。
 * Markdown 用 Streamdown 静态模式渲染（已完成内容，含代码高亮）；HTML 一律放入 sandbox="allow-scripts" 的 iframe
 * （不加 allow-same-origin），与主站隔离，防止资产脚本访问父页面会话；
 * 图片走详情端点签发的 previewUrl（私有桶签名访问，不公开桶）。
 */
export function AssetPreviewDialog({ assetId, open, onOpenChange }: AssetPreviewDialogProps) {
  const { data, isError, error } = useQuery({
    ...assetQueryOptions(assetId),
    enabled: open
  });
  // 资产可能已被删除：区分 404，给出明确文案
  const notFound = error instanceof ApiError && error.status === 404;
  // 图片加载失败跟踪（按 URL 记录）：签名 URL 不校验对象存在性，行还在但 OSS 对象缺失时会 404
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // 无预览的 design（AI 整版首轮，尚未在画布保存）：无 PNG 可看/可下，改为引导进画布
  const previewlessDesign = data?.kind === 'design' && !data.previewUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl'>
        <DialogHeader className='flex shrink-0 flex-row items-center justify-between gap-3 border-b px-4 py-3 pr-12'>
          <div className='min-w-0'>
            <DialogTitle className='truncate'>{data?.title ?? '资产预览'}</DialogTitle>
            {data?.sourceTitle && (
              <p className='text-muted-foreground truncate text-xs'>
                基于「{data.sourceTitle}」修改
              </p>
            )}
            <DialogDescription className='sr-only'>资产内容预览</DialogDescription>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            {data && <Badge variant='outline'>{getAssetKindMeta(data.kind).label}</Badge>}
            {data?.sizeBytes != null && (
              <span className='text-muted-foreground text-xs'>{formatBytes(data.sizeBytes)}</span>
            )}
            {data?.kind === 'design' && (
              <Link
                href={`/dashboard/design/${assetId}`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <Icons.edit /> 编辑
              </Link>
            )}
            {/* 文本类资产（Markdown / HTML）直接拿走 content 原文，与消息操作栏共用同一套复制能力 */}
            {data && (data.kind === 'markdown' || data.kind === 'html') && data.content && (
              <CopyButton text={data.content} variant='outline' size='sm' withLabel />
            )}
            <button
              type='button'
              onClick={() => void downloadAsset(assetId)}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              disabled={previewlessDesign}
            >
              <Icons.download /> 下载
            </button>
          </div>
        </DialogHeader>
        <div className='min-h-0 flex-1 overflow-auto'>
          {/* 错误分支独占渲染：删除后重开弹窗时 TanStack 会保留上次缓存的数据（含旧签名 URL），
              且 isError 与 data 会同时存在——若并列渲染，会出现「错误提示 + 指向已删除对象的破图」 */}
          {isError ? (
            <div className='text-destructive p-6 text-sm'>
              {notFound ? '该资产已被删除。' : '加载资产失败，请稍后重试。'}
            </div>
          ) : data ? (
            <>
              {data.kind === 'html' && (
                <iframe
                  title={data.title}
                  sandbox='allow-scripts'
                  srcDoc={data.content ?? ''}
                  className='h-full w-full bg-white'
                />
              )}
              {data.kind === 'markdown' && (
                <div className='p-5'>
                  <Streamdown mode='static' plugins={STREAMDOWN_PLUGINS}>
                    {data.content ?? ''}
                  </Streamdown>
                </div>
              )}
              {(data.kind === 'image' || data.kind === 'design') &&
                (data.previewUrl ? (
                  failedUrl === data.previewUrl ? (
                    <div className='text-destructive p-6 text-sm'>
                      图片无法加载（文件可能已被删除）。
                    </div>
                  ) : (
                    // h-full w-full 让 img 盒子填满固定高度内容区，object-contain 居中 letterbox；
                    // 若按宽度铺满（max-h-full）高度由比例算出会矮于内容区，导致底部留白（同 video 分支修复模式）
                    // oxlint-disable-next-line nextjs/no-img-element -- 直连 OSS 签名 URL（私有桶），不经图片优化器，避免 Vercel 带宽与签名缓存问题
                    <img
                      src={data.previewUrl}
                      alt={data.title}
                      className='bg-black h-full w-full object-contain'
                      onError={() => setFailedUrl(data.previewUrl ?? null)}
                    />
                  )
                ) : data.kind === 'design' ? (
                  <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm'>
                    <Icons.palette className='size-6' />
                    <p>AI 整版设计尚无预览：打开画布编辑并保存后自动生成。</p>
                    <Link
                      href={`/dashboard/design/${assetId}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      <Icons.edit /> 打开编辑
                    </Link>
                  </div>
                ) : (
                  <div className='text-muted-foreground p-6 text-sm'>图片加载中…</div>
                ))}
              {data.kind === 'video' &&
                (data.previewUrl ? (
                  // oxlint-disable-next-line jsx-a11y/media-has-caption -- AI 生成视频无字幕轨；autoPlay+muted 保证可靠自动播放（可手动取消静音）
                  <video
                    aria-label={`视频：${data.title}`}
                    controls
                    autoPlay
                    muted
                    playsInline
                    preload='metadata'
                    poster={`/api/agent/assets/${assetId}/raw?snapshot=1`}
                    src={data.previewUrl}
                    className='bg-black h-full w-full object-contain'
                  />
                ) : (
                  <div className='text-muted-foreground p-6 text-sm'>视频加载中…</div>
                ))}
            </>
          ) : (
            <div className='text-muted-foreground p-6 text-sm'>加载中…</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
