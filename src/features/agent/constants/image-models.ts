/**
 * 图片模型注册表（Phase 2）—— 与 constants/models.ts（对话模型）隔离，不污染对话模型注册表。
 *
 * 图片生成直连百炼 REST（不经 AI SDK provider：@ai-sdk/alibaba 无图像模型），
 * 端点与参数结构以官方文档为准，并经 scripts/image-smoke.ts 于经典域名
 * （dashscope.aliyuncs.com）实测通过；官方新式端点为工作空间子域名
 * （{WorkspaceId}.cn-beijing.maas.aliyuncs.com），经典域名仍可正常使用。
 *
 * 2026-09-19 模型审计：升级为 3.0 系列（官方当前推荐），移除旧代条目
 * （qwen-image 首代 / qwen-image-2.0-pro / wan2.6-t2i）。实测（北京地域，经典域名）：
 * - qwen-image-3.0：~25s、0.18 元/张（默认输出 2K 档，如 1792×2400）
 * - qwen-image-3.0-pro：~35s、0.5 元/张（旗舰，复杂版面/密集小字更强）
 *
 * 2026-09-20（Batch B 图生图迭代）：3.0 系列原生支持 I2I（图生图/图像编辑），与文生图共用同端点，
 * content = [{ image: <公网URL> }, { text: <指令> }]；实测（OSS 签名 URL 源图）：风格编辑 41.5s、
 * 改比例 size=1024*1024 13.3s。计费 = 编辑输入 0.02 元/张 + 输出同文生图价（≈0.20 元/次），
 * 无需引入 edit-plus / edit-max 系列（见方案对比）；I2I 输入上限 10MB。
 * 另：size 参数实测生效（T2I/I2I 均可，格式 "宽*高"，像素面积 512²~2048²、宽高比 1:8~8:1），
 * 常用比例预设见 ASPECT_PRESETS（全部为 1K 计费档 ≤2,250,000 面积）。
 *
 * 协议形态：
 * - sync：POST /api/v1/services/aigc/multimodal-generation/generation
 *   → output.choices[0].message.content 中首个 image 片段（I2I 可能先 text 后 image）
 * - async-task：旧异步协议（X-DashScope-Async + 轮询 /api/v1/tasks/{id}）。
 *   3.0 系列同样支持异步接入（批量/长任务场景）；当前注册表未使用，保留代码路径备用。
 *
 * 注意：3.0 系列 enable_thinking 默认为 true，会显著增加生成耗时（实测 3-4 倍），
 * 交互式生成必须在参数中显式关闭（见 api/image-generation.ts）；
 * 返回的图片链接 24h 有效，必须立即下载转存 OSS（红线）。
 */

export type ImageModelKey = 'qwen-image-3.0' | 'qwen-image-3.0-pro';

export type ImageProtocol = 'async-task' | 'sync';

export interface ImageModelRegistryEntry {
  label: string;
  description: string;
  providerModelId: string;
  protocol: ImageProtocol;
}

/** MVP 单默认模型（不做选择器）；3.0 标准版兼顾质量与速度，单价低于旧代 qwen-image */
export const DEFAULT_IMAGE_MODEL: ImageModelKey = 'qwen-image-3.0';

export const IMAGE_MODEL_REGISTRY: Record<ImageModelKey, ImageModelRegistryEntry> = {
  'qwen-image-3.0': {
    label: 'Qwen-Image 3.0',
    description: '千问图像 3.0 标准版：文字渲染稳定、复杂图文一次生成，兼顾质量与速度',
    providerModelId: 'qwen-image-3.0',
    protocol: 'sync'
  },
  // 旗舰档预留：接入模型选择器后启用（当前 generateImage 固定 DEFAULT_IMAGE_MODEL）
  'qwen-image-3.0-pro': {
    label: 'Qwen-Image 3.0 Pro',
    description: '千问图像 3.0 旗舰：复杂版面 / 密集小字渲染与真实质感更强（较慢、较贵）',
    providerModelId: 'qwen-image-3.0-pro',
    protocol: 'sync'
  }
};

export const IMAGE_MODEL_KEYS = Object.keys(IMAGE_MODEL_REGISTRY) as ImageModelKey[];

/** 常用输出比例预设（key 供工具参数枚举） */
export const ASPECT_KEYS = ['1:1', '3:4', '4:3', '3:2', '2:3', '16:9', '9:16'] as const;
export type AspectKey = (typeof ASPECT_KEYS)[number];

/** 比例 → size 参数（"宽*高"）；全部为 1K 计费档（像素面积 ≤2,250,000） */
export const ASPECT_PRESETS: Record<AspectKey, string> = {
  '1:1': '1024*1024',
  '3:4': '1080*1440',
  '4:3': '1440*1080',
  '3:2': '1536*1024',
  '2:3': '1024*1536',
  '16:9': '1920*1080',
  '9:16': '1080*1920'
};

export function isImageModelKey(value: unknown): value is ImageModelKey {
  return typeof value === 'string' && value in IMAGE_MODEL_REGISTRY;
}

export function resolveImageModel(key: string): ImageModelRegistryEntry {
  return IMAGE_MODEL_REGISTRY[isImageModelKey(key) ? key : DEFAULT_IMAGE_MODEL];
}
