import { z } from 'zod';

/**
 * 设计画布文档模型（前后端共用）。
 *
 * 核心原则（Konva 官方铁律）：文档是自持有的可序列化纯数据，Konva 节点只是交互层；
 * 图片对象只存资产引用 assetId，绝不存图片字节（历史数组 likewise 只含引用）。
 *
 * 落库约定：design 资产 kind='design'、content=JSON.stringify(DesignDocument)、
 * mime='application/json'、storageKey=导出 PNG 预览的 OSS key。
 */

const baseObjectFields = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  /** 旋转角度（度）；老文档可能缺省，默认 0 */
  rotation: z.number().default(0)
};

export const rectObjectSchema = z.object({
  ...baseObjectFields,
  type: z.literal('rect'),
  width: z.number().positive(),
  height: z.number().positive(),
  fill: z.string(),
  cornerRadius: z.number().min(0).default(0)
});

export const circleObjectSchema = z.object({
  ...baseObjectFields,
  type: z.literal('circle'),
  radius: z.number().positive(),
  fill: z.string()
});

/** 文字水平对齐（Konva Text align）；仅在设置了换行宽度 width 时可见生效 */
export const TEXT_ALIGN_VALUES = ['left', 'center', 'right'] as const;

export type TextAlign = (typeof TEXT_ALIGN_VALUES)[number];

export const textObjectSchema = z.object({
  ...baseObjectFields,
  type: z.literal('text'),
  text: z.string(),
  fontSize: z.number().positive(),
  fill: z.string(),
  /** Konva fontStyle：'normal' | 'bold' | 'italic' | 'bold italic' */
  fontStyle: z.string().default('normal'),
  /** 换行宽度（可选）；缺省时文字不换行 */
  width: z.number().positive().optional(),
  /** 水平对齐；老文档缺省默认左对齐（可选 + 默认 → 无需迁移） */
  align: z.enum(TEXT_ALIGN_VALUES).default('left')
});

export const imageObjectSchema = z.object({
  ...baseObjectFields,
  type: z.literal('image'),
  /** 引用的图片资产 id（不存字节，渲染时经 /raw 同源代理加载） */
  assetId: z.uuid(),
  width: z.number().positive(),
  height: z.number().positive()
});

export const designObjectSchema = z.discriminatedUnion('type', [
  rectObjectSchema,
  circleObjectSchema,
  textObjectSchema,
  imageObjectSchema
]);

/** 单个文档的对象数量上限（防御性；请求体另有 4MB 上限） */
export const MAX_DOCUMENT_OBJECTS = 500;

export const designDocumentSchema = z.object({
  version: z.literal(1),
  width: z.number().positive(),
  height: z.number().positive(),
  background: z.string(),
  objects: z.array(designObjectSchema).max(MAX_DOCUMENT_OBJECTS)
});

export type RectObject = z.infer<typeof rectObjectSchema>;
export type CircleObject = z.infer<typeof circleObjectSchema>;
export type TextObject = z.infer<typeof textObjectSchema>;
export type ImageObject = z.infer<typeof imageObjectSchema>;
export type DesignObject = z.infer<typeof designObjectSchema>;
export type DesignObjectType = DesignObject['type'];
export type DesignDocument = z.infer<typeof designDocumentSchema>;

/** 创建 design 资产的请求体（previewPng 为 base64，可空——纯图形文档也可先不导出预览） */
export const createDesignRequestSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  document: designDocumentSchema,
  previewPng: z.string().optional()
});

/** 更新 design 资产的请求体（字段均可选，按存在性更新） */
export const updateDesignRequestSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  document: designDocumentSchema.optional(),
  previewPng: z.string().optional()
});

export type CreateDesignRequest = z.infer<typeof createDesignRequestSchema>;
export type UpdateDesignRequest = z.infer<typeof updateDesignRequestSchema>;

/**
 * 本地图片上传响应（POST /api/agent/assets/upload）。
 * width/height 由服务端 sharp 读取；读取失败时缺省（前端回退 /raw 加载读 naturalWidth）。
 */
export interface UploadImageResponse {
  id: string;
  width?: number;
  height?: number;
}
