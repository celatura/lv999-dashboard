import type Konva from 'konva';
import type { DesignDocument } from '../api/types';

/**
 * 画布导出（Konva 官方「高质量导出」纪律）：
 * - 导出前隐藏所有 Transformer（选择手柄不入图）；
 * - 临时把相机（缩放/平移）归一并将 Stage 尺寸设为文档尺寸，使导出区域恰为整幅文档，
 *   不受当前视图缩放/平移影响；同步执行、finally 恢复，用户看不到闪烁；
 * - pixelRatio 归一：按最长边上限折算，产出稳定尺寸且避免超出浏览器 canvas 上限。
 *
 * **pixelRatio 默认上限 1（只缩不放）**：上采样不增加细节、只增体积（源图多为 1K 档），
 * 且这张预览 PNG 同时是「我的资产」的**下载产物**（sizeBytes 口径 = 下载体积），
 * 缩到小于画布尺寸会让下载到的图小于画布。
 *
 * 图片对象经同源 /raw 代理加载，画布未被跨域污染，toDataURL 正常。
 */

export interface ExportOptions {
  /** 输出最长边像素上限（控制体积/清晰度） */
  maxDimension?: number;
  /** pixelRatio 上限（1 = 不超过画布原尺寸，不做上采样） */
  maxPixelRatio?: number;
}

export function exportStageToDataURL(
  stage: Konva.Stage,
  doc: DesignDocument,
  options: ExportOptions = {}
): string {
  const maxDimension = options.maxDimension ?? 2560;
  const maxPixelRatio = options.maxPixelRatio ?? 1;
  const longestSide = Math.max(doc.width, doc.height, 1);
  const pixelRatio = Math.max(0.1, Math.min(maxPixelRatio, maxDimension / longestSide));

  const transformers = stage.find('Transformer');
  transformers.forEach((transformer) => transformer.hide());

  const previous = {
    scaleX: stage.scaleX(),
    scaleY: stage.scaleY(),
    x: stage.x(),
    y: stage.y(),
    width: stage.width(),
    height: stage.height()
  };

  try {
    stage.scaleX(1);
    stage.scaleY(1);
    stage.x(0);
    stage.y(0);
    stage.width(doc.width);
    stage.height(doc.height);
    return stage.toDataURL({ pixelRatio, mimeType: 'image/png' });
  } finally {
    stage.scaleX(previous.scaleX);
    stage.scaleY(previous.scaleY);
    stage.x(previous.x);
    stage.y(previous.y);
    stage.width(previous.width);
    stage.height(previous.height);
    transformers.forEach((transformer) => transformer.show());
    stage.batchDraw();
  }
}

/** dataURL → 纯 base64（去掉 data:...;base64, 前缀） */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * 保存用预览 PNG 的 base64 体积预算。
 * 服务端两道卡口：解码后 PNG ≤ 3MB（MAX_PREVIEW_PNG_BYTES）、请求体 ≤ 4MB（MAX_REQUEST_BYTES）；
 * base64 比解码体积大 4/3，再留出文档 JSON 与信封余量 → 取 3MB base64（≈ 2.25MB PNG）。
 */
export const PREVIEW_BASE64_BUDGET = 3 * 1024 * 1024;

/**
 * 预览导出最长边上限（1 = 只缩不放）：当前 UI 仅提供 5 个预设画布（最长边 ≤1920），
 * 因此实际永远 1:1 原尺寸导出；该上限只是引入自定义画布尺寸后的缩边兜底，
 * 届时如需体积降级再恢复降档阶梯。
 */
const PREVIEW_MAX_DIMENSION = 1920;

/**
 * 导出保存用预览 PNG（base64）；超出体积预算时返回 undefined（丢预览保文档）：
 * 带着超限载荷上去必撞 4MB 请求体卡口，整次保存 413、文档一个字节也存不下，
 * 而且每次重试都失败；服务端按 previewPng 存在性更新，不传只是「本次没刷新预览」，
 * 下次保存会再试一次。
 */
export function exportPreviewBase64(stage: Konva.Stage, doc: DesignDocument): string | undefined {
  const base64 = dataUrlToBase64(
    exportStageToDataURL(stage, doc, { maxDimension: PREVIEW_MAX_DIMENSION })
  );
  if (base64.length <= PREVIEW_BASE64_BUDGET) return base64;
  console.warn('[design] preview png exceeds budget, skipping preview upload');
  return undefined;
}

/** 触发浏览器下载 dataURL（客户端） */
export function downloadDataURL(dataUrl: string, filename: string): void {
  const link = window.document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}
