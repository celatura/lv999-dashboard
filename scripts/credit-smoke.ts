/* oxlint-disable no-console */
/**
 * Credits transaction and concurrency smoke test. Requires a migrated test database.
 * Run: bun run scripts/credit-smoke.ts
 */
import { desc, eq } from 'drizzle-orm';
import { spawnSync } from 'node:child_process';
import { getDb } from '../src/lib/db';
import { creditLedger, creditReservations, creditsAccounts } from '../src/lib/db/schema';
import {
  getCreditAccount,
  grantCredits,
  listLedger,
  reserveCredits,
  setBalance,
  settleCredits
} from '../src/features/credits/api/service';
import {
  chargeOnGenerationResult,
  InsufficientCreditsError
} from '../src/features/credits/lib/billing';
import { GenerationError } from '../src/features/agent/api/generation-error';

const userId = `credit-smoke-${crypto.randomUUID()}`;
const db = getDb();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

try {
  assert((await getCreditAccount(userId)).balance === 0, 'missing account has zero balance');
  await grantCredits({ userId, amount: 100 });
  const reservations = await Promise.all(
    Array.from({ length: 10 }, () => reserveCredits({ userId, amount: 30, kind: 'image' }))
  );
  const accepted = reservations.filter((reservation) => reservation !== null);
  assert(accepted.length === 3, 'concurrent reservations cannot overspend');
  let account = await getCreditAccount(userId);
  assert(
    account.total === 100 && account.reserved === 90 && account.balance === 10,
    'account amounts'
  );

  const first = accepted[0];
  await Promise.all([
    settleCredits({ reservationId: first.id, cost: 30 }),
    settleCredits({ reservationId: first.id, cost: 30 })
  ]);
  let conflictingSettlementRejected = false;
  try {
    await settleCredits({ reservationId: first.id, cost: 31 });
  } catch {
    conflictingSettlementRejected = true;
  }
  assert(conflictingSettlementRejected, 'conflicting settlement rejected');
  account = await getCreditAccount(userId);
  assert(
    account.total === 70 && account.reserved === 60 && account.balance === 10,
    'idempotent settlement'
  );
  await settleCredits({ reservationId: accepted[1].id, cost: 0 });
  await settleCredits({ reservationId: accepted[2].id, cost: 50 });
  account = await getCreditAccount(userId);
  assert(
    account.total === 40 && account.reserved === 0 && account.balance === 40,
    'release and capped overage'
  );
  const ledger = await listLedger(userId, { page: 1, limit: 10 });
  assert(ledger.total === 3, 'only charged settlements enter the ledger');
  assert(
    ledger.entries.some(
      (entry) => entry.meta && 'absorbedCost' in entry.meta && entry.meta.absorbedCost === 20
    ),
    'overage recorded'
  );

  const partial = await reserveCredits({ userId, amount: 50, kind: 'chat', allowPartial: true });
  assert(partial?.amount === 40, 'partial variable-cost reservation');
  await setBalance({ userId, amount: 5 });
  account = await getCreditAccount(userId);
  assert(
    account.total === 45 && account.reserved === 40 && account.balance === 5,
    'admin set preserves reservations'
  );
  await settleCredits({ reservationId: partial.id, cost: 40 });
  account = await getCreditAccount(userId);
  assert(
    account.total === 5 && account.reserved === 0 && account.balance === 5,
    'settlement after admin adjustment'
  );

  const pending = await reserveCredits({ userId, amount: 5, kind: 'image' });
  assert(pending, 'pending reservation created');
  const [persisted] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, pending.id));
  assert(persisted.status === 'pending', 'unfinished reservation persists for reconciliation');
  await settleCredits({ reservationId: pending.id, cost: 0 });

  await setBalance({ userId, amount: 30 });
  let upstreamCalls = 0;
  const generation = () =>
    chargeOnGenerationResult({
      userId,
      kind: 'image',
      fallbackCharge: { cost: 30, meta: {} },
      run: async () => {
        upstreamCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'asset';
      },
      buildCharge: () => ({ cost: 30, meta: {} })
    });
  const attempts = await Promise.allSettled([generation(), generation()]);
  assert(upstreamCalls === 1, 'fixed-price reservation precedes upstream call');
  assert(
    attempts.filter(
      (result) => result.status === 'rejected' && result.reason instanceof InsufficientCreditsError
    ).length === 1,
    'concurrent insufficient generation rejected'
  );
  assert((await getCreditAccount(userId)).balance === 0, 'successful generation charged');
  await setBalance({ userId, amount: 30 });
  for (const billable of [false, true]) {
    try {
      await chargeOnGenerationResult({
        userId,
        kind: 'image',
        fallbackCharge: { cost: 30, meta: {} },
        run: async () => {
          throw new GenerationError('test failure', { billable });
        },
        buildCharge: () => ({ cost: 30, meta: {} })
      });
      throw new Error('expected generation failure');
    } catch (error) {
      assert(error instanceof GenerationError, 'generation error preserved');
    }
    account = await getCreditAccount(userId);
    assert(
      account.reserved === 0 && account.balance === (billable ? 0 : 30),
      billable ? 'billable failure charged' : 'non-billable failure released'
    );
  }
  await setBalance({ userId, amount: 30 });
  try {
    await chargeOnGenerationResult({
      userId,
      kind: 'image',
      fallbackCharge: { cost: 30, meta: {} },
      run: async (markGenerated) => {
        markGenerated({ cost: 30 });
        throw new Error('asset storage failed');
      },
      buildCharge: () => ({ cost: 30, meta: {} })
    });
    throw new Error('expected storage failure');
  } catch (error) {
    assert(
      error instanceof Error && error.message === 'asset storage failed',
      'storage failure preserved'
    );
  }
  const [storageFailure] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.userId, userId))
    .orderBy(desc(creditReservations.createdAt))
    .limit(1);
  assert(
    storageFailure.actualCost === 30 && storageFailure.charged === 0,
    'upstream cost recorded when storage fails'
  );
  assert((await getCreditAccount(userId)).balance === 30, 'storage failure does not charge user');
  await setBalance({ userId, amount: 5 });
  const waived = await reserveCredits({ userId, amount: 5, kind: 'knowledge' });
  assert(waived, 'knowledge reservation created');
  await settleCredits({ reservationId: waived.id, cost: 3, waive: true });
  assert((await getCreditAccount(userId)).balance === 5, 'failed knowledge cost waived');
  const [waivedRecord] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, waived.id));
  assert(
    waivedRecord.actualCost === 3 && waivedRecord.charged === 0,
    'waived cost retained for audit'
  );
  let invalidAmountRejected = false;
  try {
    await setBalance({ userId, amount: -1 });
  } catch {
    invalidAmountRejected = true;
  }
  assert(
    invalidAmountRejected && (await getCreditAccount(userId)).balance === 5,
    'negative admin amount rejected'
  );

  await setBalance({ userId, amount: 100 });
  const parent = await reserveCredits({ userId, amount: 138, kind: 'chat', allowPartial: true });
  assert(parent?.amount === 100, 'chat reserves available budget');
  await chargeOnGenerationResult({
    userId,
    kind: 'image',
    parentReservationId: parent.id,
    fallbackCharge: { cost: 30, meta: {} },
    run: async () => 'asset',
    buildCharge: () => ({ cost: 30, meta: {} })
  });
  account = await getCreditAccount(userId);
  assert(account.total === 70 && account.reserved === 70, 'image can use chat reservation');
  await settleCredits({ reservationId: parent.id, cost: 4 });
  assert((await getCreditAccount(userId)).balance === 66, 'chat and image charged separately');

  await setBalance({ userId, amount: 100 });
  const refundableParent = await reserveCredits({ userId, amount: 100, kind: 'chat' });
  assert(refundableParent, 'chat reservation for refund created');
  const refundableChild = await reserveCredits({
    userId,
    amount: 30,
    kind: 'image',
    parentReservationId: refundableParent.id
  });
  assert(refundableChild, 'image borrows from chat');
  await settleCredits({ reservationId: refundableChild.id, cost: 0 });
  account = await getCreditAccount(userId);
  assert(
    account.total === 100 && account.reserved === 100,
    'unused borrowed credits return to chat'
  );
  await settleCredits({ reservationId: refundableParent.id, cost: 4 });
  assert(
    (await getCreditAccount(userId)).balance === 96,
    'refunded chat budget remains chargeable'
  );

  await setBalance({ userId, amount: 150 });
  const mixedParent = await reserveCredits({ userId, amount: 100, kind: 'chat' });
  assert(mixedParent, 'mixed reservation parent created');
  const mixedChild = await reserveCredits({
    userId,
    amount: 60,
    kind: 'image',
    parentReservationId: mixedParent.id
  });
  assert(mixedChild, 'mixed reservation uses available and parent credits');
  await settleCredits({ reservationId: mixedChild.id, cost: 20 });
  account = await getCreditAccount(userId);
  assert(
    account.total === 130 && account.reserved === 100 && account.balance === 30,
    'mixed reservation returns unspent borrowed credits'
  );
  await settleCredits({ reservationId: mixedParent.id, cost: 4 });

  await setBalance({ userId, amount: 100 });
  const parallelParent = await reserveCredits({ userId, amount: 100, kind: 'chat' });
  assert(parallelParent, 'parallel reservation parent created');
  const parallelChildren = (
    await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveCredits({
          userId,
          amount: 30,
          kind: 'image',
          parentReservationId: parallelParent.id
        })
      )
    )
  ).filter((reservation) => reservation !== null);
  assert(parallelChildren.length === 3, 'parallel tools cannot borrow the same credits');
  await Promise.all(
    parallelChildren.map((child) => settleCredits({ reservationId: child.id, cost: 30 }))
  );
  await settleCredits({ reservationId: parallelParent.id, cost: 4 });
  assert((await getCreditAccount(userId)).balance === 6, 'parallel tools and chat settle once');

  await setBalance({ userId, amount: 100 });
  const endedParent = await reserveCredits({ userId, amount: 100, kind: 'chat' });
  assert(endedParent, 'early settlement parent created');
  const lateChild = await reserveCredits({
    userId,
    amount: 30,
    kind: 'image',
    parentReservationId: endedParent.id
  });
  assert(lateChild, 'late child reservation created');
  await settleCredits({ reservationId: endedParent.id, cost: 4 });
  await settleCredits({ reservationId: lateChild.id, cost: 0 });
  account = await getCreditAccount(userId);
  assert(account.balance === 96 && account.reserved === 0, 'late child releases after chat ends');

  const manual = await reserveCredits({ userId, amount: 5, kind: 'knowledge' });
  assert(manual, 'manual reconciliation reservation created');
  const cli = spawnSync(
    process.execPath,
    ['scripts\\credit-admin.ts', 'resolve', manual.id, '3', '--confirm-stopped', '--waive'],
    { env: process.env, encoding: 'utf8' }
  );
  assert(cli.status === 0, `manual waive CLI succeeded: ${cli.stderr}`);
  const [manualRecord] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, manual.id));
  assert(
    manualRecord.actualCost === 3 && manualRecord.charged === 0,
    'manual waiver records cost without charging'
  );
  assert(
    (await getCreditAccount(userId)).balance === 96,
    'manual waiver preserves available balance'
  );
  console.log('SMOKE OK');
} finally {
  await db.delete(creditLedger).where(eq(creditLedger.userId, userId));
  await db.delete(creditsAccounts).where(eq(creditsAccounts.userId, userId));
}
