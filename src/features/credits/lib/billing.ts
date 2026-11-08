import { GenerationError, isBillableError } from '@/features/agent/api/generation-error';
import { reserveCredits, settleCredits } from '../api/service';
import { INSUFFICIENT_CREDITS_MESSAGE } from '../constants/credits';
import type { CreditKind } from '../api/types';

export class InsufficientCreditsError extends GenerationError {
  constructor() {
    super(INSUFFICIENT_CREDITS_MESSAGE, { billable: false });
    this.name = 'InsufficientCreditsError';
  }
}

/** 固定价先原子预留；已知成功或失败后结算，未知结果保留冻结供对账。 */
export async function chargeOnGenerationResult<T>(params: {
  userId: string;
  kind: Exclude<CreditKind, 'grant'>;
  parentReservationId?: string;
  /** 上游生成 + 转存落库；抛错按 billable 判定是否扣费 */
  run: (
    markGenerated: (charge: { cost: number; meta?: Record<string, unknown> }) => void
  ) => Promise<T>;
  /** 成功路径的扣费（cost + meta，meta 含 assetId 等） */
  buildCharge: (result: T) => { cost: number; meta: Record<string, unknown> };
  /** billable 失败路径的兜底扣费（生成抛错时拿不到结果，按入参/默认估算） */
  fallbackCharge: { cost: number; meta: Record<string, unknown> };
}): Promise<T> {
  const reservation = await reserveCredits({
    userId: params.userId,
    amount: params.fallbackCharge.cost,
    kind: params.kind,
    parentReservationId: params.parentReservationId,
    meta: params.fallbackCharge.meta
  });
  if (!reservation) throw new InsufficientCreditsError();
  let generatedCharge: { cost: number; meta?: Record<string, unknown> } | undefined;
  let result: T;
  try {
    result = await params.run((charge) => {
      generatedCharge = charge;
    });
  } catch (error) {
    const billable = isBillableError(error);
    const cost = generatedCharge?.cost ?? (billable ? params.fallbackCharge.cost : 0);
    try {
      await settleCredits({
        reservationId: reservation.id,
        cost,
        waive: !billable,
        meta: {
          ...params.fallbackCharge.meta,
          ...generatedCharge?.meta,
          outcome: 'failed',
          costEstimated: !generatedCharge && billable
        }
      });
    } catch (settlementError) {
      console.error('[credits] generation settlement failed; reservation remains pending', {
        reservationId: reservation.id,
        cost,
        waive: !billable,
        generatedCharge,
        error: settlementError
      });
    }
    throw error;
  }
  let charge: ReturnType<typeof params.buildCharge> | undefined;
  try {
    charge = params.buildCharge(result);
    await settleCredits({
      reservationId: reservation.id,
      cost: charge.cost,
      meta: charge.meta
    });
  } catch (error) {
    console.error('[credits] generation settlement failed; reservation remains pending', {
      reservationId: reservation.id,
      charge,
      error
    });
  }
  return result;
}
