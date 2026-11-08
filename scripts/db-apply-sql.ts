/* oxlint-disable no-console */
/**
 * 应用 drizzle 生成的迁移 SQL。
 *
 * 背景：当前阿里云 RDS 实例下 `drizzle-kit push` 会在连接阶段静默失败（无法完成 schema diff），
 * 因此采用确定性工作流：`bunx drizzle-kit generate`（由 schema.ts 生成 SQL，无需连库）
 * → 本脚本应用 SQL（默认取 journal 中最新迁移，也可传入文件名参数）。
 *
 * 用法：
 *   bunx drizzle-kit generate
 *   bun scripts/db-apply-sql.ts            # 应用 journal 中最新迁移的 SQL
 *   bun scripts/db-apply-sql.ts 0001_xxx.sql
 *
 * 原子性：整个文件的语句在单个事务中执行，任一语句失败即整体回滚，不会留下半套 schema。
 * 注意：若迁移需要 `CREATE INDEX CONCURRENTLY` 这类不能进事务的语句，必须拆出去单独执行，
 * 否则会报 `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`。
 *       （截至 0008，drizzle/ 下的迁移均无此类语句。）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const sqlDirectory = 'drizzle';
const requested = process.argv[2];
let file: string | undefined = requested;
if (!file) {
  const journal = JSON.parse(readFileSync(join(sqlDirectory, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const latestTag = journal.entries.at(-1)?.tag;
  file = latestTag ? `${latestTag}.sql` : undefined;
}
if (!file) {
  console.error('迁移日志为空，请先运行 bunx drizzle-kit generate');
  process.exit(1);
}
const filePath = join(sqlDirectory, file);
if (!existsSync(filePath)) {
  console.error(`迁移 SQL 不存在：${file}。请先生成新的迁移，或指定现存的 SQL 文件。`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL 未设置。请在 .env.local 中配置连接串（bun 会自动加载），或通过环境变量注入。'
  );
  process.exit(1);
}

const content = readFileSync(filePath, 'utf8');
const statements = content
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter(Boolean);
const sql = postgres(connectionString, { ssl: 'prefer', max: 1 });
console.log(`applying drizzle/${file}`);
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
