'use client';

import { AssetCard } from '../assets/asset-card';
import type { AgentToolPart } from '../../api/types';
import { ToolStep } from './tool-step';

/** createImageAsset / editImageAsset 共用同一渲染（edit 的 output 额外带血缘 id） */
type ImageAssetToolPart = AgentToolPart<'createImageAsset' | 'editImageAsset'>;

/**
 * 图片工具（createImageAsset 文生图 / editImageAsset 图生图）的调用状态渲染：
 * 进行中（通常 15-60 秒）→ 状态条；完成 → 资产卡片；失败 → 错误条（引导调整后重试）。
 *
 * 关于 active：AI SDK 中止语义下（stop() / abortSignal），进行中的 tool part 不会被置为终态
 * （流以 abort chunk 结束、无 tool-output-error，持久化仍是 input-available），
 * 因此仅当该消息仍在流式中才显示 loading；否则渲染中性「已停止」收尾，
 * 避免停止后残留永久转圈的「正在生成图片」状态条（刷新后同样正确还原）。
 */
export function ToolImagePart({
  part,
  active,
  mode
}: {
  part: ImageAssetToolPart;
  active: boolean;
  mode: 'create' | 'edit';
}) {
  const state = part.state;
  const verb = mode === 'edit' ? '修改' : '生成';

  if (state === 'input-streaming' || state === 'input-available') {
    const title = part.input?.title;
    if (!active) {
      return (
        <ToolStep
          state='stopped'
          title={title ? `已停止：${title} 未${verb}图片` : `已停止：图片未${verb}`}
        />
      );
    }
    return (
      <ToolStep
        state='running'
        title={`正在${verb}图片${title ? `：${title}` : '…'}（约 15–60 秒；离开页面也会继续）`}
      />
    );
  }

  if (state === 'output-available' && part.output) {
    const { assetId, title, kind, sizeBytes } = part.output;
    return <AssetCard assetId={assetId} title={title} kind={kind} sizeBytes={sizeBytes} />;
  }

  if (state === 'output-error') {
    return (
      <ToolStep
        state='error'
        title={`图片${verb}失败${mode === 'edit' ? '（可换一种修改要求后重试）' : '（可换个画面描述后重试）'}`}
        errorText={part.errorText ?? '未知错误'}
      />
    );
  }

  return null;
}
