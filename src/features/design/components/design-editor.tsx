'use client';

import type { DesignDocument } from '../api/types';
import { EditorProvider } from '../lib/editor-context';
import { EditorCanvas } from './editor-canvas';
import { EditorToolbar } from './editor-toolbar';
import { PropertiesPanel } from './properties-panel';

/**
 * 设计画布编辑器根组件（纯客户端孤岛，经 next/dynamic({ ssr:false }) 挂载）。
 * EditorProvider 持有文档/历史/相机/保存状态；布局为「顶部工具栏 + 画布 + 右侧属性/图层」。
 * 外壳由 page-scroller 撑满剩余高度，编辑器只需 flex-1，内部各自滚动。
 */
interface DesignEditorProps {
  /** 已存 design 资产 id；新建时为 null */
  assetId: string | null;
  initialTitle: string;
  initialDocument: DesignDocument;
  /** 预置图片资产 id（「在画布使用」入口）；挂载时插入画布，不自动保存 */
  initialImageAssetId?: string | null;
  /** 打开时是否已有预览 PNG（= asset.storageKey 非空）；无改动保存时据此跳过预览重导 */
  initialHasPreview?: boolean;
}

export function DesignEditor({
  assetId,
  initialTitle,
  initialDocument,
  initialImageAssetId,
  initialHasPreview
}: DesignEditorProps) {
  return (
    <EditorProvider
      assetId={assetId}
      initialTitle={initialTitle}
      initialDocument={initialDocument}
      initialImageAssetId={initialImageAssetId}
      initialHasPreview={initialHasPreview}
    >
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <EditorToolbar />
        <div className='flex min-h-0 flex-1'>
          <EditorCanvas />
          <aside className='hidden w-64 shrink-0 border-l lg:block'>
            <PropertiesPanel />
          </aside>
        </div>
      </div>
    </EditorProvider>
  );
}
