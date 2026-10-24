import {
  designDocumentSchema,
  MAX_DOCUMENT_OBJECTS,
  type DesignDocument,
  type DesignObject
} from '../api/types';
import { generateObjectId } from './document';

/**
 * 版式模板（服务端纯函数，无 Konva / 无 IO）。
 *
 * 「一句话生成整版设计」的布局质量由本模块的代码保证：坐标、字号、对齐、留白全部计算得出，
 * 模型只负责内容（标题文案 / 图片 prompt / 选哪个版式），因此不存在自由坐标导致的乱排。
 *
 * 主图一律 **contain 等比适配**（不裁切、不变形），比例不合时的留白由背景色承担——
 * 文档模型的 image 对象没有 crop 字段，因此只做 contain 适配。
 *
 * 本文件只被服务端（Agent 工具 composeDesign）引用，不进客户端 bundle。
 */

/** 版式键（composeDesign 工具的 layout 枚举） */
export const LAYOUT_KEYS = ['top-image', 'full-image-bar', 'left-image'] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];

/**
 * 支持的画布比例 → 画布尺寸（与 constants/canvas.ts 的 CANVAS_PRESETS、
 * 图片模型 ASPECT_PRESETS 的像素档一致）。此处按画布尺寸重新表达，避免 design → agent 反向依赖；
 * 未知比例（含缺省）回落竖版 3:4。
 */
const CANVAS_BY_ASPECT: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '3:4': { width: 1080, height: 1440 },
  '4:3': { width: 1440, height: 1080 },
  '3:2': { width: 1536, height: 1024 },
  '2:3': { width: 1024, height: 1536 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 }
};

/** 缺省画布比例（小红书封面常用竖版） */
export const DEFAULT_LAYOUT_ASPECT = '3:4';

export interface CanvasSize {
  width: number;
  height: number;
}

/** 比例字符串 → 画布尺寸；未知/缺省回落 DEFAULT_LAYOUT_ASPECT */
export function resolveCanvas(aspect?: string | null): CanvasSize {
  return CANVAS_BY_ASPECT[aspect ?? ''] ?? CANVAS_BY_ASPECT[DEFAULT_LAYOUT_ASPECT];
}

/** 版式配色（MVP 固定两套：浅底深字 / 深底浅字）；配色由版式自身决定，模型不参与 */
export interface LayoutPalette {
  background: string;
  heading: string;
  subheading: string;
  accent: string;
}

/** 压在图上的半透明标题条底色（仅 full-image-bar 使用，深色 scrim 保证白字可读） */
const BAR_FILL = 'rgba(15,23,42,0.72)';

const LIGHT_PALETTE: LayoutPalette = {
  background: '#ffffff',
  heading: '#0f172a',
  subheading: '#475569',
  accent: '#f97316'
};

const DARK_PALETTE: LayoutPalette = {
  background: '#0f172a',
  heading: '#ffffff',
  subheading: '#e2e8f0',
  accent: '#f59e0b'
};

export interface LayoutImage {
  assetId: string;
  /** 主图自然尺寸；缺省时按正方形适配（调用方优先用 sharp 读到的真实尺寸） */
  natural: { width: number; height: number } | null;
}

export interface LayoutText {
  heading: string;
  subheading?: string | null;
}

/** 版式产出：背景色 + 对象数组（数组顺序即层级，末尾在最上层） */
export interface ComposedLayout {
  background: string;
  objects: DesignObject[];
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 字号缩放基准画布宽（1080 = 竖版 3:4 预设宽） */
const REFERENCE_WIDTH = 1080;

/** 上图下文：主图区域占画布高的比例 */
const TOP_IMAGE_HEIGHT_RATIO = 0.6;

/** 左图右文：主图区域占画布宽的比例 */
const LEFT_IMAGE_SPLIT = 0.56;

/** CJK 等全角字符（估算文字宽度时按 1×fontSize 计） */
const WIDE_CHAR_PATTERN =
  /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

/** 估算宽度的安全系数：Konva 按词/字实际断行，估算略放宽以避免行数被低估 */
const WIDTH_SAFETY_FACTOR = 1.06;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * contain 等比适配：把自然尺寸缩放至完全落入 box（不裁切、不变形），在 box 内水平居中；
 * 垂直按 alignY 贴顶或居中（与 lib/document.ts 的 imageReplacePatch 同一 contain 口径）。
 */
function containFit(
  box: Box,
  natural: { width: number; height: number } | null,
  alignY: 'top' | 'center' = 'center'
): Box {
  const ratio =
    natural && natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;
  let width = box.width;
  let height = width / ratio;
  if (height > box.height) {
    height = box.height;
    width = height * ratio;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const offsetY = alignY === 'top' ? 0 : Math.round((box.height - height) / 2);
  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + offsetY),
    width,
    height
  };
}

/** 按画布宽等比缩放字号，并钳制在可读区间内（下限取 FONT_SIZE_PRESETS 最小档量级） */
function scaleFontSize(base: number, canvasWidth: number, min: number, max: number): number {
  return Math.round(clamp((base * canvasWidth) / REFERENCE_WIDTH, min, max));
}

/** 估算单行文字的渲染宽度（CJK ≈ 1×fontSize，其余 ≈ 0.55×fontSize） */
function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    units += WIDE_CHAR_PATTERN.test(char) ? 1 : 0.55;
  }
  return units * fontSize * WIDTH_SAFETY_FACTOR;
}

/** 估算按 maxWidth 换行后的行数（Konva Text 设 width 即自动换行） */
function estimateLines(text: string, fontSize: number, maxWidth: number): number {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const width = estimateTextWidth(paragraph, fontSize);
    lines += Math.max(1, Math.ceil(width / Math.max(1, maxWidth)));
  }
  return lines;
}

/**
 * 过长文案自动收敛字号：按 maxLines 逐档缩小（步进 2px，不低于 minSize），
 * 保证标题不会挤爆版式区域（Konva 换行 + 本函数共同兜住「模型给了超长标题」的风险）。
 */
function fitFontSize(
  text: string,
  maxWidth: number,
  preferred: number,
  maxLines: number,
  minSize: number
): number {
  let size = Math.round(preferred);
  while (size > minSize && estimateLines(text, size, maxWidth) > maxLines) {
    size -= 2;
  }
  return Math.max(minSize, size);
}

/** 单行容许的字号收缩幅度（缩到原字号的 85% 以内就宁可单行） */
const SINGLE_LINE_TOLERANCE = 0.85;

/**
 * 选字号：短文案优先单行。
 *
 * Konva 对 CJK 按字断行，「城市漫步地图」被拆成「城市漫步地 / 图」这类断词很难看；
 * 而标题本来就是一句话，单行观感优于两行。因此只需缩 ≤15% 字号就能一行排下时按单行；
 * 否则（长标题缩到单行会小到不可读）维持多行换行。
 */
function pickFontSize(
  text: string,
  maxWidth: number,
  preferred: number,
  maxLines: number,
  minSize: number
): number {
  const oneLine = fitFontSize(text, maxWidth, preferred, 1, minSize);
  // 额外校验“真的能单行”：minSize 接近 preferred 时，fitFontSize 会被地板钳住而仍可能换行
  if (oneLine >= preferred * SINGLE_LINE_TOLERANCE && estimateLines(text, oneLine, maxWidth) <= 1) {
    return oneLine;
  }
  return fitFontSize(text, maxWidth, preferred, maxLines, minSize);
}

/** Konva Text 默认 lineHeight=1，故文字块高度 = 行数 × 字号 */
function textBlockHeight(lines: number, fontSize: number): number {
  return lines * fontSize;
}

function imageObject(box: Box, assetId: string): DesignObject {
  return {
    id: generateObjectId(),
    type: 'image',
    x: box.x,
    y: box.y,
    rotation: 0,
    assetId,
    width: box.width,
    height: box.height
  };
}

function rectObject(box: Box, fill: string, cornerRadius = 0): DesignObject {
  return {
    id: generateObjectId(),
    type: 'rect',
    x: box.x,
    y: box.y,
    rotation: 0,
    width: box.width,
    height: box.height,
    fill,
    cornerRadius
  };
}

function textObject(params: {
  x: number;
  y: number;
  width: number;
  text: string;
  fontSize: number;
  fill: string;
  align: 'left' | 'center' | 'right';
  bold?: boolean;
}): DesignObject {
  return {
    id: generateObjectId(),
    type: 'text',
    x: Math.round(params.x),
    y: Math.round(params.y),
    rotation: 0,
    text: params.text,
    fontSize: params.fontSize,
    fill: params.fill,
    fontStyle: params.bold ? 'bold' : 'normal',
    width: Math.round(params.width),
    align: params.align
  };
}

/** 文字块（标题 + 可选副标题 + 可选装饰条）的排布结果 */
interface TextBlock {
  objects: DesignObject[];
  height: number;
}

/**
 * 组装「装饰条 + 主标题 + 副标题」文字块（垂直堆叠，间距按字号比例）。
 * align 决定文字在 width 内的对齐与装饰条的落点（居中版式装饰条水平居中，左对齐版式贴左）。
 */
function buildTextBlock(params: {
  heading: string;
  subheading: string | null;
  box: Box;
  align: 'left' | 'center' | 'right';
  palette: LayoutPalette;
  headingSize: number;
  subheadingSize: number;
  /** 标题最大行数（超出自动缩字号） */
  maxLines: number;
  withAccent: boolean;
}): TextBlock {
  const { box, align, palette } = params;
  const headingMin = Math.max(18, Math.round(params.headingSize * 0.5));
  const headingSize = pickFontSize(
    params.heading,
    box.width,
    params.headingSize,
    params.maxLines,
    headingMin
  );
  const headingLines = estimateLines(params.heading, headingSize, box.width);
  const subheading = params.subheading?.trim() ? params.subheading.trim() : null;
  const subheadingMin = Math.max(14, Math.round(params.subheadingSize * 0.6));
  const subheadingSize = subheading
    ? pickFontSize(subheading, box.width, params.subheadingSize, 2, subheadingMin)
    : 0;
  const subheadingLines = subheading ? estimateLines(subheading, subheadingSize, box.width) : 0;

  const accentHeight = Math.max(6, Math.round(headingSize * 0.09));
  const accentWidth = Math.round(box.width * (align === 'center' ? 0.14 : 0.18));
  const accentGap = Math.round(headingSize * 0.42);
  const subGap = Math.round(headingSize * 0.4);

  const objects: DesignObject[] = [];
  let cursorY = box.y;
  if (params.withAccent) {
    const accentX = align === 'center' ? box.x + Math.round((box.width - accentWidth) / 2) : box.x;
    objects.push(
      rectObject(
        { x: accentX, y: cursorY, width: accentWidth, height: accentHeight },
        palette.accent,
        Math.round(accentHeight / 2)
      )
    );
    cursorY += accentHeight + accentGap;
  }

  objects.push(
    textObject({
      x: box.x,
      y: cursorY,
      width: box.width,
      text: params.heading,
      fontSize: headingSize,
      fill: palette.heading,
      align,
      bold: true
    })
  );
  cursorY += textBlockHeight(headingLines, headingSize);

  if (subheading && subheadingSize > 0) {
    cursorY += subGap;
    objects.push(
      textObject({
        x: box.x,
        y: cursorY,
        width: box.width,
        text: subheading,
        fontSize: subheadingSize,
        fill: palette.subheading,
        align
      })
    );
    cursorY += textBlockHeight(subheadingLines, subheadingSize);
  }

  return { objects, height: cursorY - box.y };
}

/**
 * 上图下文（封面常用）：主图贴顶 contain 适配上部 ~60% 区域，
 * 文字块（装饰条 + 居中标题 + 副标题）在图下方的剩余空间内垂直居中。
 */
function topImageLayout(canvas: CanvasSize, image: LayoutImage, text: LayoutText): ComposedLayout {
  const palette = LIGHT_PALETTE;
  const margin = Math.round(canvas.width * 0.06);
  const imageBoxHeight = Math.round(canvas.height * TOP_IMAGE_HEIGHT_RATIO);
  const fitted = containFit(
    { x: 0, y: 0, width: canvas.width, height: imageBoxHeight },
    image.natural,
    'top'
  );

  const textWidth = canvas.width - margin * 2;
  const areaTop = fitted.y + fitted.height;
  const areaHeight = Math.max(1, canvas.height - areaTop);
  // 文字块先在 (0,0) 处组装量高，再整体下移到剩余空间的垂直中心
  const block = buildTextBlock({
    heading: text.heading,
    subheading: text.subheading ?? null,
    box: { x: margin, y: 0, width: textWidth, height: areaHeight },
    align: 'center',
    palette,
    headingSize: scaleFontSize(72, canvas.width, 32, 128),
    subheadingSize: scaleFontSize(30, canvas.width, 18, 56),
    maxLines: 2,
    withAccent: true
  });
  const offsetY = Math.round(clamp((areaHeight - block.height) / 2, margin * 0.5, areaHeight));
  const objects = block.objects.map((object) => ({ ...object, y: object.y + areaTop + offsetY }));

  return {
    background: palette.background,
    objects: [imageObject(fitted, image.assetId), ...objects]
  };
}

/**
 * 全图 + 底部标题条：主图 contain 适配整幅画布，底部半透明深色条内放白色居中标题 + 副标题。
 * 条高按文字块实际高度自适应（钳制在画布高的 16%~42%），避免长标题被条截断。
 */
function fullImageBarLayout(
  canvas: CanvasSize,
  image: LayoutImage,
  text: LayoutText
): ComposedLayout {
  const palette = DARK_PALETTE;
  const fitted = containFit(
    { x: 0, y: 0, width: canvas.width, height: canvas.height },
    image.natural
  );
  const margin = Math.round(canvas.width * 0.06);
  const textWidth = canvas.width - margin * 2;

  // 文字块先在 (0,0) 组装量高，再据高度定标题条尺寸（条始终包住文字）并整体移入条内垂直居中
  const block = buildTextBlock({
    heading: text.heading,
    subheading: text.subheading ?? null,
    box: { x: margin, y: 0, width: textWidth, height: canvas.height },
    align: 'center',
    palette,
    headingSize: scaleFontSize(56, canvas.width, 28, 96),
    subheadingSize: scaleFontSize(26, canvas.width, 16, 44),
    maxLines: 2,
    withAccent: false
  });
  const padding = Math.round(canvas.height * 0.035);
  const barHeight = Math.round(
    clamp(block.height + padding * 2, canvas.height * 0.16, canvas.height * 0.42)
  );
  const barTop = canvas.height - barHeight;
  // 条高被上限钳制时（文字极多）仍至少留一个 padding，宁可略压图也不贴边
  const offsetY = barTop + Math.round(Math.max(padding, (barHeight - block.height) / 2));
  const objects = block.objects.map((object) => ({ ...object, y: object.y + offsetY }));

  return {
    background: palette.background,
    objects: [
      imageObject(fitted, image.assetId),
      rectObject({ x: 0, y: barTop, width: canvas.width, height: barHeight }, BAR_FILL),
      ...objects
    ]
  };
}

/**
 * 左图右文（横版）：主图 contain 适配左半区，右半区左对齐标题 + 副标题垂直居中。
 * 竖版画布自动退化为 top-image（左右分栏在竖版下文字区过窄）。
 */
function leftImageLayout(canvas: CanvasSize, image: LayoutImage, text: LayoutText): ComposedLayout {
  if (canvas.height > canvas.width) {
    return topImageLayout(canvas, image, text);
  }
  const palette = LIGHT_PALETTE;
  const splitX = Math.round(canvas.width * LEFT_IMAGE_SPLIT);
  const fitted = containFit({ x: 0, y: 0, width: splitX, height: canvas.height }, image.natural);

  const margin = Math.round(canvas.width * 0.05);
  const textX = splitX + margin;
  const textWidth = Math.max(1, canvas.width - margin - textX);
  const block = buildTextBlock({
    heading: text.heading,
    subheading: text.subheading ?? null,
    box: { x: textX, y: 0, width: textWidth, height: canvas.height },
    align: 'left',
    palette,
    headingSize: scaleFontSize(64, canvas.width, 30, 112),
    subheadingSize: scaleFontSize(28, canvas.width, 18, 48),
    maxLines: 3,
    withAccent: true
  });
  const offsetY = Math.round(clamp((canvas.height - block.height) / 2, margin, canvas.height));
  const objects = block.objects.map((object) => ({ ...object, y: object.y + offsetY }));

  return {
    background: palette.background,
    objects: [imageObject(fitted, image.assetId), ...objects]
  };
}

/** 版式注册表：key 即工具入参枚举值；配色由各版式自选（模型不参与配色决策） */
const LAYOUTS: Record<
  LayoutKey,
  (canvas: CanvasSize, image: LayoutImage, text: LayoutText) => ComposedLayout
> = {
  'top-image': topImageLayout,
  'full-image-bar': fullImageBarLayout,
  'left-image': leftImageLayout
};

/**
 * 对象规整（sanitize）：坐标/尺寸钳制到画布内、对象数封顶、image 引用只允许本次产出的主图。
 * 版式函数产出本已合规，这里是防御层（也是「模型臆造 assetId / 越界」的统一兜底）。
 */
function sanitizeObjects(
  objects: DesignObject[],
  canvas: CanvasSize,
  allowedAssetId: string
): DesignObject[] {
  const sanitized: DesignObject[] = [];
  for (const object of objects.slice(0, MAX_DOCUMENT_OBJECTS)) {
    if (object.type === 'image') {
      if (object.assetId !== allowedAssetId) continue;
      const width = clamp(object.width, 1, canvas.width);
      const height = clamp(object.height, 1, canvas.height);
      sanitized.push({
        ...object,
        width,
        height,
        x: clamp(object.x, 0, Math.max(0, canvas.width - width)),
        y: clamp(object.y, 0, Math.max(0, canvas.height - height))
      });
      continue;
    }
    if (object.type === 'rect') {
      const width = clamp(object.width, 1, canvas.width);
      const height = clamp(object.height, 1, canvas.height);
      sanitized.push({
        ...object,
        width,
        height,
        x: clamp(object.x, 0, Math.max(0, canvas.width - width)),
        y: clamp(object.y, 0, Math.max(0, canvas.height - height))
      });
      continue;
    }
    if (object.type === 'circle') {
      const radius = clamp(object.radius, 1, Math.min(canvas.width, canvas.height) / 2);
      sanitized.push({
        ...object,
        radius,
        x: clamp(object.x, radius, Math.max(radius, canvas.width - radius)),
        y: clamp(object.y, radius, Math.max(radius, canvas.height - radius))
      });
      continue;
    }
    // text：位置钳制在画布内；换行宽度不超过右边界（高度由 Konva 按内容换行决定）
    const x = clamp(object.x, 0, Math.max(0, canvas.width - 1));
    sanitized.push({
      ...object,
      x,
      y: clamp(object.y, 0, Math.max(0, canvas.height - 1)),
      ...(object.width ? { width: clamp(object.width, 1, Math.max(1, canvas.width - x)) } : {})
    });
  }
  return sanitized;
}

/**
 * 主图区域的宽高比（宽 / 高）：供调用方挑选最接近的文生图比例档。
 *
 * 主图比例贴合版式区域时，contain 适配后几乎无留白（画布比例仍由 aspect 决定，两者可不同）：
 * 例如 3:4 竖版画布的上图下文版式，主图区域为 1080×864（近 4:3）→ 生图选 4:3 而非 3:4。
 */
export function imageRegionRatio(layout: LayoutKey, aspect?: string | null): number {
  const canvas = resolveCanvas(aspect);
  if (layout === 'full-image-bar') return canvas.width / canvas.height;
  // left-image 在竖版画布下退化为上图下文，区域比例随之取上图下文的口径
  if (layout === 'left-image' && canvas.width >= canvas.height) {
    return (canvas.width * LEFT_IMAGE_SPLIT) / canvas.height;
  }
  return canvas.width / (canvas.height * TOP_IMAGE_HEIGHT_RATIO);
}

/** 兜底版式：主图居中 contain + 标题居中（组装链路出问题时仍产出可用文档） */
function fallbackLayout(canvas: CanvasSize, image: LayoutImage, text: LayoutText): ComposedLayout {
  const palette = LIGHT_PALETTE;
  const margin = Math.round(canvas.width * 0.06);
  const fitted = containFit(
    { x: 0, y: 0, width: canvas.width, height: Math.round(canvas.height * 0.7) },
    image.natural,
    'top'
  );
  const headingSize = scaleFontSize(56, canvas.width, 28, 96);
  return {
    background: palette.background,
    objects: [
      imageObject(fitted, image.assetId),
      textObject({
        x: margin,
        y: fitted.y + fitted.height + Math.round(canvas.height * 0.05),
        width: canvas.width - margin * 2,
        text: text.heading,
        fontSize: headingSize,
        fill: palette.heading,
        align: 'center',
        bold: true
      })
    ]
  };
}

/**
 * 组装完整设计文档：解析画布尺寸 → 执行版式 → sanitize → schema 终校验。
 *
 * 全函数式、无 IO，保证「同一入参必得同一文档」；schema 校验失败时回落兜底版式，
 * 仍失败才抛错（正常入参下不可达——文生图已扣费，此处必须尽最大努力产出可用文档）。
 */
export function composeDesignDocument(params: {
  layout: LayoutKey;
  aspect?: string | null;
  image: LayoutImage;
  text: LayoutText;
}): DesignDocument {
  const canvas = resolveCanvas(params.aspect);
  const heading = params.text.heading.trim() || '未命名设计';
  const composed = LAYOUTS[params.layout](canvas, params.image, {
    heading,
    subheading: params.text.subheading
  });

  const parsed = designDocumentSchema.safeParse({
    version: 1,
    width: canvas.width,
    height: canvas.height,
    background: composed.background,
    objects: sanitizeObjects(composed.objects, canvas, params.image.assetId)
  });
  if (parsed.success) return parsed.data;

  const fallback = fallbackLayout(canvas, params.image, { heading, subheading: null });
  const fallbackParsed = designDocumentSchema.safeParse({
    version: 1,
    width: canvas.width,
    height: canvas.height,
    background: fallback.background,
    objects: sanitizeObjects(fallback.objects, canvas, params.image.assetId)
  });
  if (fallbackParsed.success) return fallbackParsed.data;

  throw new Error('设计文档组装失败，请稍后重试。');
}
