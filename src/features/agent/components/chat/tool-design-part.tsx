'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { AgentToolPart } from '../../api/types';
import { ToolStep } from './tool-step';

type DesignAssetToolPart = AgentToolPart<'composeDesign'>;

/** 版式键 → 中文标签（加载态展示模型选了哪个版式，让等待有信息量） */
const LAYOUT_LABELS: Record<string, string> = {
  'top-image': '上图下文',
  'full-image-bar': '全图标题条',
  'left-image': '左图右文'
};

/**
 * composeDesign（一句话生成整版设计）的调用状态渲染：
 * 进行中（含一次文生图，约 20-70 秒）→ 状态条；完成 → 可点进画布的 design 卡片；失败 → 错误条。
 *
 * 产出的 design 首轮无预览 PNG（预览由画布保存时客户端导出），故卡片不提供预览/下载，
 * 只给「打开编辑」直达 /dashboard/design/[id]。
 *
 * 关于 active：与 ToolImagePart 同理——AI SDK 中止语义下进行中的 tool part 不落终态，
 * 非流式（active=false）时渲染中性「已停止」收尾，避免残留永久转圈的状态条。
 */
export function ToolDesignPart({ part, active }: { part: DesignAssetToolPart; active: boolean }) {
  const state = part.state;

  if (state === 'input-streaming' || state === 'input-available') {
    const title = part.input?.title;
    const layout = part.input?.layout ? LAYOUT_LABELS[part.input.layout] : undefined;
    if (!active) {
      return (
        <ToolStep
          state='stopped'
          title={title ? `已停止：${title} 未生成整版设计` : '已停止：整版设计未生成'}
        />
      );
    }
    return (
      <ToolStep
        state='running'
        title={`正在生成整版设计${title ? `：${title}` : '…'}${layout ? `（${layout}）` : ''}（含文生图，约 20–70 秒；离开页面也会继续）`}
      />
    );
  }

  if (state === 'output-available' && part.output) {
    const { assetId, title } = part.output;
    return (
      <div className='bg-card flex items-center gap-3 rounded-xl border p-3'>
        <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
          <Icons.palette className='size-4' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{title}</p>
          <div className='text-muted-foreground mt-1 flex items-center gap-2 text-xs'>
            <Badge variant='outline'>整版设计</Badge>
            <span className='truncate'>已排好版，进画布可继续微调</span>
          </div>
        </div>
        <Link
          href={`/dashboard/design/${assetId}`}
          className={cn(buttonVariants({ size: 'sm' }), 'shrink-0')}
        >
          <Icons.edit /> 打开编辑
        </Link>
      </div>
    );
  }

  if (state === 'output-error') {
    return (
      <ToolStep
        state='error'
        title='整版设计生成失败（可换个画面描述或版式后重试）'
        errorText={part.errorText ?? '未知错误'}
      />
    );
  }

  return null;
}
