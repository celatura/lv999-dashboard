import { getSignedUrl } from '@/lib/oss';
import { ASPECT_PRESETS, type AspectKey } from '../constants/image-models';
import { generateImage } from './image-generation';
import { createImageAsset, getAsset } from './service';

/**
 * 图片编辑（I2I）核心流程（server-only）：与聊天会话解耦，供两处复用——
 * 1. 聊天内 editImageAsset 工具（agent.ts，带 conversationId 与 abortSignal）；
 * 2. 资产行「继续修改」直连端点（POST /api/agent/assets/[id]/edit，无会话）。
 *
 * 流程：归属 + kind='image' + storageKey + ≤10MB 预检 → 源图签名 URL（900s，覆盖生成全程）
 * → generateImage（qwen-image-3.0 原生 I2I）→ createImageAsset（sourceAssetId 记录血缘）。
 */

/** 图像编辑（I2I）源图体积上限：百炼输入上限 10MB（低于入库 15MB 红线，编辑前预检拦截） */
export const MAX_EDIT_SOURCE_BYTES = 10 * 1024 * 1024;

/** 可预期的编辑失败（源图缺失/非图片/超限）；直连端点据此映射 apiError 而非 500 */
export class ImageEditError extends Error {
  constructor(
    readonly code: 'source_not_found' | 'source_too_large',
    message: string
  ) {
    super(message);
    this.name = 'ImageEditError';
  }
}

/** 派生资产默认标题：「源标题·修改」（createImageAsset title 上限 100 字符） */
function buildDerivedTitle(sourceTitle: string): string {
  return `${sourceTitle.slice(0, 90)}·修改`;
}

export async function editImageAssetCore(params: {
  userId: string;
  sourceAssetId: string;
  instruction: string;
  /** 可选：改变输出比例（不传则延续源图构图，由模型自动推荐分辨率） */
  aspect?: AspectKey;
  /** 新资产标题（聊天工具由模型给出；直连端点缺省用「源标题·修改」） */
  title?: string;
  /** 归属会话（聊天内编辑传入；直连编辑为 null，资产与会话解耦） */
  conversationId?: string | null;
  /** 中止信号（聊天「停止」联动；直连端点不传） */
  signal?: AbortSignal;
  onGenerated?: () => void;
}): Promise<{ id: string; title: string; sizeBytes: number }> {
  // 归属校验：源资产必须属于当前用户、为图片且已转入 OSS（文本资产不可编辑）
  const source = await getAsset(params.userId, params.sourceAssetId);
  if (!source || source.kind !== 'image' || !source.storageKey) {
    throw new ImageEditError('source_not_found', '找不到可修改的源图片资产（可能已被删除）。');
  }
  if (source.sizeBytes && source.sizeBytes > MAX_EDIT_SOURCE_BYTES) {
    throw new ImageEditError('source_too_large', '源图片体积超过编辑输入上限（10MB），无法修改。');
  }

  // 源图经短期签名 URL 直传百炼（公网可达；TTL 900s 覆盖生成全程）
  const referenceImageUrl = await getSignedUrl(source.storageKey, 900);
  const size = params.aspect ? ASPECT_PRESETS[params.aspect] : undefined;
  const { imageBuffer, mime } = await generateImage({
    prompt: params.instruction,
    referenceImageUrl,
    size,
    signal: params.signal
  });
  params.onGenerated?.();

  const title = params.title?.trim() || buildDerivedTitle(source.title);
  const asset = await createImageAsset({
    userId: params.userId,
    conversationId: params.conversationId ?? null,
    title,
    prompt: params.instruction,
    imageBuffer,
    mime,
    sourceAssetId: params.sourceAssetId
  });
  return { id: asset.id, title, sizeBytes: asset.sizeBytes };
}
