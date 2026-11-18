'use client';

import { AssetCard } from '../assets/asset-card';
import type { AssetKind } from '../../api/types';
import { ToolStep } from './tool-step';

/** 供消息渲染层断言使用：保留 output 等完整字段类型，避免双重断言抹掉结构 */
export interface CreateAssetToolPart {
  state: string;
  input?: { title?: string } | undefined;
  output?: { assetId: string; title: string; kind: AssetKind; sizeBytes: number } | undefined;
  errorText?: string;
}

/**
 * createAsset / editAsset 工具的调用状态渲染：
 * 生成中 → 状态条；完成 → 资产卡片；失败 → 错误条。
 *
 * 关于 active：与 ToolImagePart 同理——AI SDK 中止语义下进行中的 tool part 不落终态，
 * 非流式（active=false）时渲染中性「已停止」收尾，避免残留永久转圈的状态条。
 */
export function ToolAssetPart({
  part,
  active,
  mode = 'create'
}: {
  part: CreateAssetToolPart;
  active: boolean;
  /** edit = editAsset 精确编辑（文案用「更新」）；create = createAsset 新建（文案用「保存」） */
  mode?: 'create' | 'edit';
}) {
  const state = part.state;
  const action = mode === 'edit' ? '更新' : '保存';

  if (state === 'input-streaming' || state === 'input-available') {
    const title = part.input?.title;
    if (!active) {
      return (
        <ToolStep
          state='stopped'
          title={title ? `已停止：${title} 未${action}` : `已停止：资产未${action}`}
        />
      );
    }
    return (
      <ToolStep
        state='running'
        title={`${mode === 'edit' ? '正在编辑资产' : '正在生成资产'}${title ? `：${title}` : '…'}`}
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
        title={`资产${action}失败`}
        errorText={part.errorText ?? '未知错误'}
      />
    );
  }

  return null;
}
