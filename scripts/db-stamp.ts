/* oxlint-disable no-console */
/**
 * 把「已经存在结构的数据库」接入 `drizzle-kit migrate` 的已应用记录。
 *
 * 背景：迁移链是后来重建的（drizzle/0000_baseline.sql 等），现有库早已通过手工 SQL 建成，
 * 直接跑 `bun run db:migrate` 会重复执行 CREATE TABLE 而失败。本脚本按 drizzle-orm
 * 迁移器的规则（sha256(sql) + journal.when）补写 drizzle.__drizzle_migrations 记录，
 * 让后续增量迁移可以正常被识别。
 *
 * 用法：
 *   bun scripts/db-stamp.ts            # 只预览将写入的记录（默认 dry-run）
 *   bun scripts/db-stamp.ts --apply    # 真正写入
 *
 * 安全约束：
 * - 目标库必须已包含本项目表（credits_accounts / knowledge_chunks / user），否则拒绝执行
 * - 已有迁移记录且仍有未写入的迁移时拒绝执行（说明该库落后，应直接跑 db:migrate）
 * - 幂等：已存在的 hash 不会重复写入
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const migrationsFolder = 'drizzle';
const apply = process.argv.includes('--apply');
const requiredTables = ['credits_accounts', 'knowledge_chunks', 'user'];

const journal = JSON.parse(
  readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
) as { entries: { idx: number; when: number; tag: string }[] };

const migrations = journal.entries.map((entry) => {
  const query = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
  return {
    tag: entry.tag,
    hash: createHash('sha256').update(query).digest('hex'),
    createdAt: entry.when
  };
});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL 未设置。请在 .env.local 中配置连接串（bun 会自动加载）。');
  process.exit(1);
}

const sql = postgres(connectionString, { ssl: 'prefer', max: 1, onnotice: () => {} });
try {
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const present = new Set(tables.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !present.has(name));
  if (missing.length > 0) {
    console.error(
      `目标库缺少本项目表：${missing.join(', ')}。这不是已有库，请直接运行 bun run db:migrate。`
    );
    process.exit(1);
  }

  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await sql.unsafe(
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)'
  );

  const applied = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id
  `;
  const appliedHashes = new Set(applied.map((row) => row.hash));
  const pending = migrations.filter((migration) => !appliedHashes.has(migration.hash));

  console.log(`目标库已有迁移记录 ${applied.length} 条，待补写 ${pending.length} 条`);
  for (const migration of pending) {
    console.log(
      `- ${migration.tag}  hash=${migration.hash.slice(0, 12)}…  created_at=${migration.createdAt}`
    );
  }

  if (pending.length === 0) {
    console.log('无需补写，已是最新。');
  } else if (applied.length > 0) {
    console.error(
      '已有迁移记录但仍存在未写入的迁移：该库落后于代码，请直接运行 bun run db:migrate。'
    );
    process.exit(1);
  } else if (!apply) {
    console.log('dry-run：确认无误后加 --apply 写入。');
  } else {
    for (const migration of pending) {
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.createdAt})
      `;
    }
    console.log(`已写入 ${pending.length} 条迁移记录。`);
  }
} finally {
  await sql.end();
}
