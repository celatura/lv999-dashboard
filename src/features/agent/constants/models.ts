/**
 * 模型注册表 —— UI 与数据库使用内部 key，provider model ID 是映射细节。
 *
 * 百炼（阿里云百炼 Model Studio）model ID 以控制台实际列表为准；
 * 若某个模型不被官方 provider 包支持，可将 transport 改为 'compatible'
 * 走百炼 OpenAI 兼容模式（同一 API Key）。
 *
 * 命名原则：优先用主线名，不用带日期的快照名 —— 按官方下线机制，
 * 快照模型仅提前 30 天通知下线，主线模型提前 3 个月（https://help.aliyun.com/zh/model-studio/model-depreciation）。
 * 内部 key 是落库值（conversations.model）与计费表 key，改 providerModelId 无需迁移数据。
 */

export type ModelKey = 'deepseek-flash' | 'deepseek-v4-pro' | 'qwen3.8-flash' | 'qwen3.8-max';

export type ModelTransport = 'alibaba' | 'compatible';

export interface ModelRegistryEntry {
  label: string;
  description: string;
  providerModelId: string;
  transport: ModelTransport;
  capabilities: {
    multimodal?: boolean;
    thinking?: boolean;
  };
}

export const DEFAULT_MODEL: ModelKey = 'deepseek-flash';

export const MODEL_REGISTRY: Record<ModelKey, ModelRegistryEntry> = {
  'deepseek-flash': {
    label: 'DeepSeek V4.1 Flash',
    description: '默认模型：速度快、成本低，原生多模态（官方滚动别名 deepseek-flash）',
    providerModelId: 'deepseek-v4.1-flash',
    transport: 'alibaba',
    capabilities: { multimodal: true, thinking: true }
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek V4 Pro',
    description: '更强旗舰，适合复杂长文创作（用主线名，避开仅提前 30 天通知下线的日期快照）',
    providerModelId: 'deepseek-v4-pro',
    transport: 'alibaba',
    capabilities: { thinking: true }
  },
  'qwen3.8-flash': {
    label: 'Qwen3.8 Flash',
    description: '通义千问快速版：多模态、百万级上下文',
    providerModelId: 'qwen3.8-flash',
    transport: 'alibaba',
    capabilities: { multimodal: true, thinking: true }
  },
  'qwen3.8-max': {
    label: 'Qwen3.8 Max',
    description: '通义千问旗舰：2.4T MoE，综合能力最强',
    providerModelId: 'qwen3.8-max',
    transport: 'alibaba',
    capabilities: { multimodal: true, thinking: true }
  }
};

/**
 * 模型不可用（已下线 / 未开通 / 不存在）的用户可读文案。
 * 服务端映射（api/model-availability.ts）与客户端透传（chat/chat-window.tsx）共用同一常量：
 * 客户端据此识别「已是可操作中文」并原样展示，不再退化成通用的「生成出错了」。
 */
export const MODEL_RETIRED_MESSAGE = '当前模型已下线或未开通，请在上方切换到其他模型后重试。';
export const MODEL_NOT_FOUND_MESSAGE =
  '当前模型在百炼不存在（可能已下架或 model ID 变更），请联系管理员检查模型配置。';

/** 上述文案集合，供客户端精确匹配后原样透传 */
export const MODEL_UNAVAILABLE_MESSAGES = [MODEL_RETIRED_MESSAGE, MODEL_NOT_FOUND_MESSAGE] as const;

export const MODEL_KEYS = Object.keys(MODEL_REGISTRY) as ModelKey[];

export function isModelKey(value: unknown): value is ModelKey {
  return typeof value === 'string' && value in MODEL_REGISTRY;
}

export function getModelLabel(key: string): string {
  return isModelKey(key) ? MODEL_REGISTRY[key].label : key;
}
