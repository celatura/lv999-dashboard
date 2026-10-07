'use client';

import { useQuery } from '@tanstack/react-query';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assetQueryOptions } from '../../api/queries';
import { downloadAsset } from '../../lib/asset-download';
import { formatBytes } from '../../lib/format';
import type { AssetKind } from '../../api/types';

/** 供消息渲染层断言使用：保留 output 等完整字段类型，避免双重断言抹掉结构 */
export interface VideoAssetToolPart {
  state: string;
  input?: { title?: string } | undefined;
  output?:
    | {
        assetId: string;
        title: string;
        kind: AssetKind;
        sizeBytes: number;
        sourceAssetId?: string;
      }
    | undefined;
  errorText?: string;
}

/**
 * 完成态：对话内可播放视频卡片。
 * - 视频 src 走详情端点签发的 previewUrl（直连 OSS，原生支持 Range，可拖动进度）；
 * - poster 走同源截帧代理 /raw?snapshot=1（OSS 视频截帧，加载前显示封面，避免黑屏等待）；
 * - 单个视频用 preload="metadata" 合理（用户即将观看，预加载元数据提升首帧速度）。
 */
function VideoResultCard({
  assetId,
  title,
  sizeBytes
}: {
  assetId: string;
  title: string;
  sizeBytes: number;
}) {
  const { data } = useQuery(assetQueryOptions(assetId));
  const posterUrl = `/api/agent/assets/${assetId}/raw?snapshot=1`;
  const previewUrl = data?.previewUrl ?? null;

  return (
    <div className='bg-card overflow-hidden rounded-xl border'>
      <div className='bg-black flex w-full items-center justify-center'>
        {previewUrl ? (
          // oxlint-disable-next-line jsx-a11y/media-has-caption -- AI 生成视频无字幕轨；保留 wan3.0 原生音频，不静音
          <video
            aria-label={`视频：${title}`}
            controls
            preload='metadata'
            poster={posterUrl}
            src={previewUrl}
            className='max-h-[60vh] w-full object-contain'
          />
        ) : (
          <div className='text-muted-foreground flex aspect-video w-full items-center justify-center gap-2 text-sm'>
            <Icons.spinner className='size-4 animate-spin' /> 视频加载中…
          </div>
        )}
      </div>
      <div className='flex items-center gap-3 p-3'>
        <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
          <Icons.video className='size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{title}</p>
          <p className='text-muted-foreground mt-0.5 text-xs'>
            视频{typeof sizeBytes === 'number' ? ` · ${formatBytes(sizeBytes)}` : ''}
          </p>
        </div>
        <button
          type='button'
          onClick={() => void downloadAsset(assetId)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
        >
          <Icons.download /> 下载
        </button>
      </div>
    </div>
  );
}

/**
 * 视频工具（createVideoAsset 文生视频 / createVideoFromImageAsset 图生视频）的调用状态渲染：
 * 进行中（通常 1-5 分钟）→ 状态条；完成 → 内联可播放视频卡片；失败 → 错误条。
 *
 * 关于 active：与 ToolImagePart 同理——AI SDK 中止语义下进行中的 tool part 不落终态，
 * 非流式（active=false）时渲染中性「已停止」收尾，避免残留永久转圈的状态条（刷新后同样正确还原）。
 */
export function ToolVideoPart({ part, active }: { part: VideoAssetToolPart; active: boolean }) {
  const state = part.state;

  if (state === 'input-streaming' || state === 'input-available') {
    const title = part.input?.title;
    if (!active) {
      return (
        <div className='text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm'>
          <Icons.clock className='size-4' />
          已停止：{title ? `${title} 未生成视频` : '视频未生成'}
        </div>
      );
    }
    return (
      <div className='text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm'>
        <Icons.spinner className='size-4 animate-spin' />
        {/* 离开安全（可恢复流）的承诺：视频是最长的长任务，明确告知预计耗时与「离开也继续」 */}
        <span>正在生成视频{title ? `：${title}` : '…'}（预计 1-5 分钟；离开页面也会继续）</span>
      </div>
    );
  }

  if (state === 'output-available' && part.output) {
    const { assetId, title, sizeBytes } = part.output;
    return <VideoResultCard assetId={assetId} title={title} sizeBytes={sizeBytes} />;
  }

  if (state === 'output-error') {
    // errorText 为服务端映射好的完整中文（route.ts onError 对 GenerationError 原样透传，
    // 如「视频下载失败，请稍后重试。」），直接展示；不再套「视频生成失败：」前缀与重试后缀
    return (
      <div className='border-destructive/40 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm'>
        {part.errorText ?? '视频生成失败，请稍后重试。'}
      </div>
    );
  }

  return null;
}
