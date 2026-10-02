import { requireUserId } from '@/lib/auth-session';
import { DesignEditorIsland } from '@/features/design/components/design-editor-island';
import { createEmptyDocument } from '@/features/design/constants/canvas';
import { getAsset } from '@/features/agent/api/service';
import { isUuid } from '@/lib/utils';
import type { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: 设计画布'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

/**
 * 新建设计：渲染空白画布；首次保存时创建 design 资产并跳转到 /dashboard/design/[id]。
 * 支持 ?imageAssetId= 预置图片（「我的资产」→「在画布使用」入口）：
 * 校验归属与类型后透传给编辑器，挂载时作为初始 image 对象插入画布（不自动保存）。
 */
export default async function DesignNewPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const rawImageAssetId = searchParams.imageAssetId;

  let initialImageAssetId: string | null = null;
  if (typeof rawImageAssetId === 'string' && isUuid(rawImageAssetId)) {
    const userId = await requireUserId();
    // 归属 + 类型校验：越权/非图片/已删除一律忽略参数（回退空白画布，不 404）
    const asset = userId ? await getAsset(userId, rawImageAssetId) : undefined;
    if (asset && asset.kind === 'image' && asset.storageKey) {
      initialImageAssetId = asset.id;
    }
  }

  return (
    <DesignEditorIsland
      assetId={null}
      initialTitle='未命名设计'
      initialDocument={createEmptyDocument()}
      initialImageAssetId={initialImageAssetId}
    />
  );
}
