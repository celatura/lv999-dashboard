import type { DesignDocument } from '../api/types';

/** 画布尺寸预设（宽 × 高）；沿用图片模型 ASPECT_PRESETS 的常用比例思路 */
export interface CanvasPreset {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { label: '竖版 3:4', width: 1080, height: 1440 },
  { label: '方形 1:1', width: 1024, height: 1024 },
  { label: '横版 16:9', width: 1920, height: 1080 },
  { label: '横版 4:3', width: 1440, height: 1080 },
  { label: '手机壁纸 9:16', width: 1080, height: 1920 }
];

/** 新建空白画布的默认尺寸/背景 */
export const DEFAULT_CANVAS = {
  width: 1080,
  height: 1440,
  background: '#ffffff'
};

/** 属性面板可选填充色（覆盖常见配色，含黑白与主题色） */
export const FILL_SWATCHES = [
  '#0f172a',
  '#ffffff',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899'
];

/** 字号预设（属性面板快捷选择） */
export const FONT_SIZE_PRESETS = [16, 24, 32, 48, 64, 96];

/** 矩形圆角预设（属性面板快捷选择）；含新建矩形的默认值 12，保证预设组总有高亮态 */
export const CORNER_RADIUS_PRESETS = [0, 8, 12, 24, 48];

/**
 * 文字换行宽度预设（文档坐标 px）：设了 width 文字才自动换行，
 * 对齐（align）也仅在带 width 时可见生效；「不限」清除 width 回到自由文字。
 * 档位按最小预设画布（1024 宽）也能容下的口径取，不随当前画布自适应。
 */
export const TEXT_WRAP_WIDTH_PRESETS = [360, 540, 720];

/**
 * 画布文字字体：Konva Text 与 overlay <textarea> 必须使用同一字体，
 * 否则编辑态与渲染态度量不一致（WYSIWYG 失败）。Konva 默认即 Arial。
 */
export const TEXT_FONT_FAMILY = 'Arial, sans-serif';

/** 新建对象的默认样式（居中放置，尺寸适配常见画布） */
export const OBJECT_DEFAULTS = {
  rect: { width: 320, height: 200, fill: '#3b82f6', cornerRadius: 12 },
  circle: { radius: 120, fill: '#8b5cf6' },
  text: {
    text: '双击编辑文字',
    fontSize: 48,
    fill: '#0f172a',
    fontStyle: 'normal',
    align: 'left'
  }
} as const;

/** 缩放范围（相对指针缩放 / 工具栏缩放按 1.2 倍率步进） */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/** 创建一个空白文档（version=1） */
export function createEmptyDocument(preset?: { width: number; height: number }): DesignDocument {
  return {
    version: 1,
    width: preset?.width ?? DEFAULT_CANVAS.width,
    height: preset?.height ?? DEFAULT_CANVAS.height,
    background: DEFAULT_CANVAS.background,
    objects: []
  };
}
