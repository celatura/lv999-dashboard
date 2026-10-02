import { requireUserId } from '@/lib/auth-session';
import { notFound } from 'next/navigation';
import { getAsset } from '@/features/agent/api/service';
import { DesignEditorIsland } from '@/features/design/components/design-editor-island';
import { createEmptyDocument } from '@/features/design/constants/canvas';
import { parseDesignDocument } from '@/features/design/lib/document';
import { isUuid } from '@/lib/utils';

export const metadata = {
  title: 'Dashboard: 设计画布'
};

type PageProps = {
  params: Promise<{ id: string }>;
};

/** 打开已存 design：归属 + 类型校验，把文档作为初始状态传入客户端编辑器 */
export default async function DesignEditPage({ params }: PageProps) {
  const userId = await requireUserId();
  if (!userId) notFound();

  const { id } = await params;
  if (!isUuid(id)) notFound();

  const asset = await getAsset(userId, id);
  if (!asset || asset.kind !== 'design') notFound();

  // 文档损坏/版本不符时回退空白文档（不阻断编辑；用户可重新保存覆盖）
  const parsed = parseDesignDocument(asset.content);
  const initialDocument = parsed ?? createEmptyDocument();

  return (
    <DesignEditorIsland
      key={asset.id}
      assetId={asset.id}
      initialTitle={asset.title}
      initialDocument={initialDocument}
      // 已有预览且预览对应当前文档才算 true：文档解析失败而回退空白时，
      // 旧 PNG 已不描述画布内容，必须当作无预览强制下次保存重导
      initialHasPreview={asset.storageKey !== null && parsed !== null}
    />
  );
}
