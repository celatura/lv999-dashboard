/* oxlint-disable no-console */
/**
 * Credits 管理员 CLI —— 能运行本脚本（持 DATABASE_URL）即视为管理员，无应用内角色判定。
 *
 * 用法：
 *   bun scripts/credit-admin.ts grant <userId> <amount> [--note "..."]   # 发放（upsert 账户 + balance+=amount + 流水）
 *   bun scripts/credit-admin.ts balance <userId>                          # 查询余额（无账户=0）
 *   bun scripts/credit-admin.ts set <userId> <amount> [--note "..."]      # 直接设定余额（写调整流水）
 *
 * 复用 features/credits/api/service（经 getDb()）；无参数/非法参数打印用法并 exit(1)。
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/lib/db';
import { creditReservations } from '../src/lib/db/schema';
import {
  getCreditAccount,
  grantCredits,
  setBalance,
  settleCredits
} from '../src/features/credits/api/service';

function usage(): never {
  console.error(`用法：
  bun scripts/credit-admin.ts grant <userId> <amount> [--note "..."]
  bun scripts/credit-admin.ts balance <userId>
  bun scripts/credit-admin.ts set <userId> <amount> [--note "..."]
  bun scripts/credit-admin.ts pending <userId>
  bun scripts/credit-admin.ts resolve <reservationId> <actualCost> --confirm-stopped [--waive]`);
  process.exit(1);
}

/** 从剩余参数解析 --note 的值（shell 会把引号内的值作为单个 argv 传入） */
function parseNote(args: string[]): string | undefined {
  const index = args.indexOf('--note');
  return index >= 0 ? args[index + 1] : undefined;
}

const [command, userId, amountArg, ...rest] = process.argv.slice(2);
if (!command || !userId) usage();

if (command === 'balance') {
  const account = await getCreditAccount(userId);
  console.log(
    `${userId}: available=${account.balance}, reserved=${account.reserved}, total=${account.total}`
  );
  process.exit(0);
}

if (command === 'pending') {
  const reservations = await getDb()
    .select()
    .from(creditReservations)
    .where(and(eq(creditReservations.userId, userId), eq(creditReservations.status, 'pending')));
  console.log(JSON.stringify(reservations, null, 2));
  process.exit(0);
}

if (command === 'resolve') {
  if (!amountArg || !/^\d+$/.test(amountArg) || !rest.includes('--confirm-stopped')) usage();
  await settleCredits({
    reservationId: userId,
    cost: Number(amountArg),
    waive: rest.includes('--waive'),
    meta: { resolvedManually: true }
  });
  console.log(
    `已结算预留 ${userId}；实际费用 ${amountArg}${rest.includes('--waive') ? '；用户费用已免除' : ''}`
  );
  process.exit(0);
}

if (command === 'grant' || command === 'set') {
  if (!amountArg || !/^\d+$/.test(amountArg)) {
    console.error('amount 必须是整数');
    usage();
  }
  const amount = Number(amountArg);
  const note = parseNote(rest);
  if (command === 'grant') {
    if (amount <= 0) {
      console.error('grant 的 amount 不能为 0');
      usage();
    }
    const balance = await grantCredits({ userId, amount, note });
    console.log(`已发放 ${amount} credits 给 ${userId}；当前余额 = ${balance}`);
  } else {
    const balance = await setBalance({ userId, amount, note });
    console.log(`已设定 ${userId} 余额 = ${balance}`);
  }
  process.exit(0);
}

console.error(`未知命令：${command}`);
usage();
