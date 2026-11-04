/* oxlint-disable no-console */
/**
 * 应用 drizzle 生成的迁移 SQL。
 *
 * 背景：当前阿里云 RDS 实例下 `drizzle-kit push` 会在连接阶段静默失败（无法完成 schema diff），
 * 因此采用确定性工作流：`bunx drizzle-kit generate`（由 schema.ts 生成 SQL，无需连库）
 * → 本脚本应用 SQL（默认按文件名排序取 drizzle/ 下最新的 .sql，也可传入文件名参数）。
 *
 * 用法：
 *   bunx drizzle-kit generate
 *   bun scripts/db-apply-sql.ts            # 应用最新一个 .sql
 *   bun scripts/db-apply-sql.ts 0001_xxx.sql
 *
 * 原子性：整个文件的语句在单个事务中执行，任一语句失败即整体回滚，不会留下半套 schema。
 * 注意：若迁移需要 `CREATE INDEX CONCURRENTLY` 这类不能进事务的语句，必须拆出去单独执行，
 * 否则会报 `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`。
 *       （截至 0008，drizzle/ 下的迁移均无此类语句。）
 */
import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

const sqlDirectory = 'drizzle';
const requested = process.argv[2];
const candidates = readdirSync(sqlDirectory)
  .filter((file) => file.endsWith('.sql'))
  .toSorted();
const file = requested ?? candidates.at(-1);
if (!file) {
  console.error('drizzle/ 下没有 .sql 文件，请先运行 bunx drizzle-kit generate');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL 未设置。请在 .env.local 中配置连接串（bun 会自动加载），或通过环境变量注入。'
  );
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'prefer', max: 1 });
console.log(`applying drizzle/${file}`);
const content = readFileSync(`${sqlDirectory}/${file}`, 'utf8');
const statements = content
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
try {
  await sql.begin(async (tx) => {
    for (const statement of statements) {
      await tx.unsafe(statement);
      console.log('  ok:', statement.split('\n')[0].slice(0, 90));
    }
  });
  console.log(`committed: drizzle/${file}（${statements.length} 条语句）`);
} finally {
  await sql.end();
}
