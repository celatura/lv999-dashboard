/**
 * Credits 定价常量（已按百炼 2026-09 中国内地真实单价校准；可随账单微调）。
 *
 * 基准：1 credit ≈ ¥0.01；credits 为整数，扣费 ceil 向上取整（宁可多扣不足 1，作者侧永不亏损）。
 * 换算：credits/1K token = ¥每百万 ÷ 10（因 1 credit≈¥0.01）；取值略高于真实成本（保守）。
 *
 * P0 开工前置：以百炼控制台账单校准（尤其视频按分辨率×秒）。
 */

import type { VideoResolutionTier } from '@/features/agent/constants/video-models';

/** 对话模型每 1K token 的 credits（input/output 分价；百炼 output 通常 3-4 倍于 input） */
export interface ChatModelPricing {
  inputPer1k: number;
  outputPer1k: number;
}

export const CREDIT_PRICING = {
  /** 对话：按模型每 1K token 的 credits；未列模型回退 chatFallback */
  chatPerModel: {
    'deepseek-flash': { inputPer1k: 0.2, outputPer1k: 0.6 },
    /**
     * ⚠️ 待按账单校准：上游曾公告「v4-pro 请求路由至 V4.1 Flash 并按 flash 单价计费」
     * （后又收回，口径反复）。一旦百炼侧发生同样路由，本档（0.5/1.5）就高于真实成本、
     * 会多扣用户 credits。改注册表后跑 `bun run scripts/model-audit.ts` 并对照控制台账单确认。
     */
    'deepseek-v4-pro': { inputPer1k: 0.5, outputPer1k: 1.5 },
    'qwen3.8-flash': { inputPer1k: 0.2, outputPer1k: 0.6 },
    'qwen3.8-max': { inputPer1k: 0.8, outputPer1k: 2.4 }
  } satisfies Record<string, ChatModelPricing>,
  /** 未列模型的保守回退档（≈flash） */
  chatFallback: { inputPer1k: 0.2, outputPer1k: 0.6 } satisfies ChatModelPricing,
  /** 图片：每张固定 credits（百炼 qwen-image-3.0 ≈¥0.18-0.3/张；T2I 与 I2I 同价） */
  imagePerAsset: 30,
  imageEditPerAsset: 30,
  /** 视频：分辨率档每秒 credits（百炼中国内地：480P≈¥0.3/秒、720P≈¥0.6/秒、1080P≈¥1.0/秒） */
  videoPerSecondByResolution: {
    '480P': 30,
    '720P': 60,
    '1080P': 100
  } satisfies Record<VideoResolutionTier, number>,
  /** 知识库摄取：embedding 每 1K token 的 credits（text-embedding-v4≈¥0.5/百万，略保守） */
  embeddingPer1k: 0.1
} as const;

/** 体验号建议额度（≈¥5；够 1 条 720P 短视频 + 大量对话/图片） */
export const DEFAULT_GRANT_TRIAL = 500;
