/**
 * 视频模型注册表 —— 与 constants/image-models.ts（图片）、constants/models.ts（对话）隔离。
 *
 * 视频生成走 AI SDK v7 的 experimental_generateVideo + @ai-sdk/alibaba 的 videoModel()，
 * provider 内部完成「提交异步任务 → 轮询状态 → 下载视频字节」全流程（见 api/video-generation.ts）。
 *
 * 2026-09 模型审计（以百炼官方最新为准）：
 * - wan3.0-video（官方推荐最新，统一 T2V + I2V）：480P/720P/1080P，6 种比例，2-30s，原生音画同步
 * - wan3.0-video-prime（优速版）：同上，生成更快、质量保持 high
 *
 * 2026-09-30（下线名单自查）：移除 wan2.6-t2v / wan2.6-i2v-flash 两个「后备」条目 ——
 * 官方已标注「推荐使用 Wan 3.0」，且注册表无任何调用路径（agent.ts 只传 DEFAULT_VIDEO_MODEL /
 * DEFAULT_I2V_MODEL），留着只会扩大后续老旧模型退役批次的排查面。
 * 需要后备时再按当时的官方推荐重新登记（见 scripts/model-audit.ts）。
 *
 * provider 契约要点（@ai-sdk/alibaba@2.0.44）：
 * - videoModel(id) 返回 Experimental_VideoModelV4，仅实现 doStart/doStatus（异步任务 + 轮询），
 *   必须传 poll 或依赖 SDK 的 start/status 回退；返回的临时 video_url 由 SDK 内部下载，不外泄。
 * - 顶层 resolution 需为 `${number}x${number}` 像素格式，provider 内部经 resolutionTierMap 映射回
 *   720P/1080P/480P 档；故这里维护 (档 × 比例) → 像素尺寸 的映射（VIDEO_RESOLUTION_DIMENSIONS）。
 * - ratio（宽高比）经 providerOptions.alibaba.ratio 或顶层 aspectRatio 传入，wan3 默认 adaptive。
 *
 * 红线：临时 video_url 24h 有效，必须立即下载转存 OSS，任何持久化字段不得存临时 URL。
 */

export type VideoModelKey = 'wan3.0-video' | 'wan3.0-video-prime';

export type VideoMode = 't2v' | 'i2v' | 'unified';

export type VideoResolutionTier = '480P' | '720P' | '1080P';

export interface VideoModelRegistryEntry {
  /** 内部 key（= 百炼模型 id） */
  key: VideoModelKey;
  /** 展示名 */
  label: string;
  /** 百炼模型 id */
  providerModelId: string;
  /** 生成模式：wan3.0 为统一模型（T2V + I2V） */
  mode: VideoMode;
  /** 是否支持原生音画同步 */
  supportsAudio: boolean;
  /** 最大时长（秒） */
  maxDuration: number;
  /** 支持的分辨率档 */
  resolutions: VideoResolutionTier[];
  /** 优速版标记 */
  isPrime?: boolean;
}

export const VIDEO_MODEL_REGISTRY: Record<VideoModelKey, VideoModelRegistryEntry> = {
  'wan3.0-video': {
    key: 'wan3.0-video',
    label: '万相 3.0 视频（推荐）',
    providerModelId: 'wan3.0-video',
    mode: 'unified',
    supportsAudio: true,
    maxDuration: 30,
    resolutions: ['480P', '720P', '1080P']
  },
  'wan3.0-video-prime': {
    key: 'wan3.0-video-prime',
    label: '万相 3.0 视频·优速',
    providerModelId: 'wan3.0-video-prime',
    mode: 'unified',
    supportsAudio: true,
    maxDuration: 30,
    resolutions: ['480P', '720P', '1080P'],
    isPrime: true
  }
};

export const VIDEO_MODEL_KEYS = Object.keys(VIDEO_MODEL_REGISTRY) as VideoModelKey[];

/** 默认模型：wan3.0-video（官方推荐最新，统一 T2V + I2V） */
export const DEFAULT_VIDEO_MODEL: VideoModelKey = 'wan3.0-video';

/** 优速版（生成更快） */
export const PRIME_VIDEO_MODEL: VideoModelKey = 'wan3.0-video-prime';

/** I2V 默认模型：wan3.0-video 为统一模型，传入首帧即走图生视频 */
export const DEFAULT_I2V_MODEL: VideoModelKey = 'wan3.0-video';

/** 视频宽高比（wan3 支持 adaptive；其余为固定比例） */
export const VIDEO_ASPECT_KEYS = ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'] as const;
export type VideoAspectKey = (typeof VIDEO_ASPECT_KEYS)[number];

/**
 * (分辨率档 × 比例) → 像素尺寸（`${w}x${h}`）。
 * 取值与 provider 内部 resolutionTierMap 完全一致，保证映射回正确的档位；
 * adaptive 比例不在此表（由模型自动推断，生成时省略 resolution 仅传 aspectRatio）。
 */
export const VIDEO_RESOLUTION_DIMENSIONS: Record<
  VideoResolutionTier,
  Partial<Record<VideoAspectKey, `${number}x${number}`>>
> = {
  '480P': { '16:9': '832x480', '9:16': '480x832', '1:1': '624x624' },
  '720P': {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '960x960',
    '4:3': '1088x832',
    '3:4': '832x1088'
  },
  '1080P': {
    '16:9': '1920x1080',
    '9:16': '1080x1920',
    '1:1': '1440x1440',
    '4:3': '1632x1248',
    '3:4': '1248x1632'
  }
};

export function isVideoModelKey(value: unknown): value is VideoModelKey {
  return typeof value === 'string' && value in VIDEO_MODEL_REGISTRY;
}

export function resolveVideoModel(key: string): VideoModelRegistryEntry {
  return VIDEO_MODEL_REGISTRY[isVideoModelKey(key) ? key : DEFAULT_VIDEO_MODEL];
}

/**
 * 解析 (档 × 比例) → 顶层 resolution 像素尺寸；
 * adaptive 或该档无对应比例时返回 undefined（生成时仅传 aspectRatio，由模型推断尺寸）。
 */
export function resolveVideoResolution(
  tier: VideoResolutionTier,
  aspect: VideoAspectKey
): `${number}x${number}` | undefined {
  return VIDEO_RESOLUTION_DIMENSIONS[tier]?.[aspect];
}
