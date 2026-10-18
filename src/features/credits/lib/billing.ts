import { isBillableError } from '@/features/agent/api/generation-error';
import { chargeCredits } from '../api/service';
import type { CreditKind } from '../api/types';

/**
 * 生成类调用（图片/视频）的计费包裹 —— 「发起后按结果扣」（见 docs/credits.md §6/§7）。
 *
 * 语义：
 * - run() 成功 → 按 buildCharge(result) 扣费（含 assetId 等计量明细）。
 * - run() 抛 billable GenerationError（abort / 轮询超时 / 已生成后下载失败）→
 *   按 fallbackCharge 扣费（上游可能/已计费，保守照扣）后 re-throw。
 * - run() 抛其他错误（鉴权 / 参数 / 限流 / 审核拒绝 / 本地转存失败）→ 不扣，re-throw。
 *
 * run() 须把「上游生成（含下载）」与「转存落库」都包含进来：
 * 生成阶段的 billable 错误由 generation-error 分类；转存失败为本地基础设施故障（非 billable），
 * 由作者吸收（极简取舍，见 docs/credits.md §7「下载阶段失败」指 generateImage 内的 downloadImage）。
 *
 * 注意：调用方须在 run() 之前自行完成 checkBalance 入口拦截。
 */
export async function chargeOnGenerationResult<T>(params: {
  userId: string;
  kind: CreditKind;
  /** 上游生成 + 转存落库；抛错按 billable 判定是否扣费 */
  run: () => Promise<T>;
  /** 成功路径的扣费（cost + meta，meta 含 assetId 等） */
  buildCharge: (result: T) => { cost: number; meta: Record<string, unknown> };
  /** billable 失败路径的兜底扣费（生成抛错时拿不到结果，按入参/默认估算） */
  fallbackCharge: { cost: number; meta: Record<string, unknown> };
}): Promise<T> {
  let result: T;
  try {
    result = await params.run();
  } catch (error) {
    if (isBillableError(error)) {
      try {
        await chargeCredits({
          userId: params.userId,
          cost: params.fallbackCharge.cost,
          kind: params.kind,
          meta: params.fallbackCharge.meta
        });
      } catch (chargeError) {
        // 兜底扣费失败不掩盖原始生成错误（漏收由作者吸收，需按日志对账）
        console.error(
          '[credits] fallback charge failed (generation error preserved):',
          chargeError
        );
      }
    }
    throw error;
  }
  const charge = params.buildCharge(result);
  try {
    await chargeCredits({
      userId: params.userId,
      cost: charge.cost,
      kind: params.kind,
      meta: charge.meta
    });
  } catch (chargeError) {
    // 生成与落库已成功：结算失败不阻断结果返回（与对话/知识库口径一致），漏收由作者吸收
    console.error('[credits] settle charge failed (result kept):', chargeError);
  }
  return result;
}
