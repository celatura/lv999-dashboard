import { Icons, type Icon } from '@/components/icons';
import type { AssetKind } from './asset-kinds';

export interface AssetKindMeta {
  label: string;
  icon: Icon;
}

/**
 * 资产类型统一元数据：对话卡片、预览弹窗、资产表格列共用一个来源，
 * 消除多处重复的 kind 判断与文案。
 */
export const ASSET_KIND_META: Record<AssetKind, AssetKindMeta> = {
  markdown: { label: 'Markdown', icon: Icons.post },
  html: { label: 'HTML', icon: Icons.code },
  image: { label: '图片', icon: Icons.media },
  design: { label: '设计', icon: Icons.palette },
  video: { label: '视频', icon: Icons.video }
};

/** 表格筛选/展示顺序 */
export const ASSET_KINDS = Object.keys(ASSET_KIND_META) as AssetKind[];

/** 宽松读取：兼容未知历史 kind，避免渲染崩溃 */
export function getAssetKindMeta(kind: string): AssetKindMeta {
  return (
    (ASSET_KIND_META as Record<string, AssetKindMeta>)[kind] ?? {
      label: kind,
      icon: Icons.page
    }
  );
}
