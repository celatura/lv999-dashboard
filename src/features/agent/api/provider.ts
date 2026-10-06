import { createAlibaba } from '@ai-sdk/alibaba';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { EMBEDDING_MODEL } from '../constants/embedding';
import { DEFAULT_MODEL, isModelKey, MODEL_REGISTRY, type ModelKey } from '../constants/models';

/**
 * 百炼对话端点（OpenAI 兼容模式，中国大陆 region）。
 * 注意 provider 包默认指向 dashscope-intl（新加坡），大陆账号必须覆盖为下面的地址。
 */
const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

/**
 * 百炼 embedding 端点（DashScope 原生协议，非 OpenAI 兼容模式）。
 * @ai-sdk/alibaba 的 embeddingBaseURL 默认指向 dashscope-intl（新加坡）的 /api/v1；
 * 本项目为国内 key，必须覆盖为经典域名（与视频通道一致）。
 */
const DASHSCOPE_EMBEDDING_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';

/**
 * 百炼视频生成端点（DashScope 原生协议，非 OpenAI 兼容模式）。
 * @ai-sdk/alibaba 的 videoBaseURL 默认指向 dashscope-intl（新加坡）；本项目为国内 key，
 * 必须显式覆盖为经典域名 dashscope.aliyuncs.com（与图片生成通道一致）。
 */
const DASHSCOPE_VIDEO_BASE_URL = 'https://dashscope.aliyuncs.com';

function getApiKey(): string {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error(
      'DASHSCOPE_API_KEY is not set. Add your Aliyun Bailian (Model Studio) API key to .env.local.'
    );
  }
  return apiKey;
}

let alibabaProvider: ReturnType<typeof createAlibaba> | undefined;
let alibabaVideoProvider: ReturnType<typeof createAlibaba> | undefined;

/**
 * 对话 + embedding 共用单例：同一 createAlibaba 实例用 baseURL（对话，OpenAI 兼容模式）
 * 与 embeddingBaseURL（向量化，DashScope 原生端点）分别路由到不同子路径。
 */
function getAlibabaProvider() {
  if (!alibabaProvider) {
    alibabaProvider = createAlibaba({
      apiKey: getApiKey(),
      baseURL: DASHSCOPE_BASE_URL,
      embeddingBaseURL: DASHSCOPE_EMBEDDING_BASE_URL
    });
  }
  return alibabaProvider;
}

/**
 * 视频生成专用 provider（独立单例）：videoModel() 走 DashScope 原生视频端点，
 * 与对话（OpenAI 兼容端点）、embedding（原生 /api/v1 端点）分属不同子路径，故单独配置 videoBaseURL。
 */
function getAlibabaVideoProvider() {
  if (!alibabaVideoProvider) {
    alibabaVideoProvider = createAlibaba({
      apiKey: getApiKey(),
      videoBaseURL: DASHSCOPE_VIDEO_BASE_URL
    });
  }
  return alibabaVideoProvider;
}

/**
 * 把内部模型 key 解析为 AI SDK 模型实例（统一走 @ai-sdk/alibaba 对话通道）。
 */
export function resolveModel(key: ModelKey | string): LanguageModel {
  const modelKey: ModelKey = isModelKey(key) ? key : DEFAULT_MODEL;
  const entry = MODEL_REGISTRY[modelKey];
  return getAlibabaProvider().chatModel(entry.providerModelId);
}

/**
 * 知识库向量化模型：走 @ai-sdk/alibaba 原生 embedding 端点（同一 API Key）。
 * 包 API 为 `embeddingModel()`；维度由调用方经 providerOptions.alibaba.dimension 传入 EMBEDDING_DIM。
 */
export function resolveEmbeddingModel(): EmbeddingModel {
  return getAlibabaProvider().embeddingModel(EMBEDDING_MODEL);
}

/**
 * 视频生成模型：走 @ai-sdk/alibaba 的 videoModel()（DashScope 原生端点，国内地域）。
 * 返回 Experimental_VideoModelV4（仅实现 doStart/doStatus，异步任务 + 轮询），
 * 交由 ai 的 experimental_generateVideo 驱动；返回类型由 SDK 推断，可直接作为其 model 入参。
 */
export function resolveVideoModel(providerModelId: string) {
  return getAlibabaVideoProvider().videoModel(providerModelId);
}
