/**
 * 定价引擎（纯函数）：token / 张 / 秒 → credits。
 *
 * 规则：ceil 向上取整、单次至少 1 credit（Math.max(1, Math.ceil(...))）——
 * 宁可多扣不足 1，避免小数累积与负零；「不亏损」仅指上游 API 成本，不含基础设施与失败吸收。
 * token 为 undefined 时按 0 处理并 console.warn（provider 未回 usage 的防御）。
 */

import type { VideoResolutionTier } from '@/features/agent/constants/video-models';
import { CREDIT_PRICING, type ChatModelPricing } from '../constants/pricing';

/** 统一取整：至少 1 credit（cost 恒 ≥1，扣费不设「余额不足则跳过」） */
function toCredits(value: number): number {
  return Math.max(1, Math.ceil(value));
}

/** 防御 undefined token（provider 未回 usage）：按 0 处理并告警 */
function safeTokens(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    console.warn(`[credits] usage.${label} is undefined, treated as 0`);
    return 0;
  }
  return value;
}

function resolveChatPricing(modelKey: string): ChatModelPricing {
  const table = CREDIT_PRICING.chatPerModel as Record<string, ChatModelPricing | undefined>;
  const pricing = table[modelKey];
  if (!pricing) {
    // 注册表新增模型但未配价：回退 flash 费率会低估成本，打日志避免静默漏收
    console.warn(`[credits] pricing missing for chat model "${modelKey}", fallback to flash rate`);
    return CREDIT_PRICING.chatFallback;
  }
  return pricing;
}

/** 对话：input/output 分价，按模型每 1K token 费率换算 */
export function priceChat(modelKey: string, inputTokens: number, outputTokens: number): number {
  const pricing = resolveChatPricing(modelKey);
  const input = safeTokens(inputTokens, 'inputTokens');
  const output = safeTokens(outputTokens, 'outputTokens');
  const value = (input / 1000) * pricing.inputPer1k + (output / 1000) * pricing.outputPer1k;
  return toCredits(value);
}

/** 图片：每张固定 credits（T2I 与 I2I 同价，isEdit 仅用于流水 meta 区分） */
export function priceImage(isEdit: boolean): number {
  return toCredits(isEdit ? CREDIT_PRICING.imageEditPerAsset : CREDIT_PRICING.imagePerAsset);
}

/** 视频：分辨率档每秒 credits × 秒数（ceil 取整） */
export function priceVideo(resolution: VideoResolutionTier, durationSeconds: number): number {
  const perSecond =
    CREDIT_PRICING.videoPerSecondByResolution[resolution] ??
    CREDIT_PRICING.videoPerSecondByResolution['720P'];
  const seconds = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return toCredits(perSecond * seconds);
}

/** 知识库摄取：embedding 每 1K token 费率换算 */
export function priceEmbedding(tokens: number): number {
  const safe = safeTokens(tokens, 'tokens');
  return toCredits((safe / 1000) * CREDIT_PRICING.embeddingPer1k);
}
