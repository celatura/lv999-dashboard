import { defineConfig } from 'drizzle-kit';

// drizzle-kit 不会自动读取 .env.local（Next.js 的本地环境文件约定），
// 这里显式加载，保证 `bun run db:push` 等命令无需额外传参即可拿到 DATABASE_URL。
// 已有环境变量优先（CI/生产直接注入真实变量时不受影响）。
try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local 不存在时忽略，交由 drizzle-kit 报错提示缺少连接串
}

export default defineConfig({
  // 业务表（schema.ts）+ Better Auth 认证表（auth-schema.ts，由 `npx auth generate` 产出）
  schema: ['./src/lib/db/schema.ts', './src/lib/db/auth-schema.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ''
  }
});
