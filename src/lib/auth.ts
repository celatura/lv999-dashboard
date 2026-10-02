import 'server-only';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { after } from 'next/server';
import { getDb } from '@/lib/db';
import * as authSchema from '@/lib/db/auth-schema';
import { sendMail } from '@/lib/mailer';

/**
 * Better Auth 服务端配置（自托管，替代 Clerk）。
 *
 * - **database**：复用现有阿里云 RDS（Drizzle + postgres.js），provider `pg`；auth 五表
 *   （user/session/account/verification/rate_limit）由 `npx auth generate` 产出 `db/auth-schema.ts` 并迁移。
 * - **emailAndPassword**：邮箱 + 密码（min 12）；密码重置走 SMTP（`lib/mailer`），
 *   重置后吊销全部旧会话（revokeSessionsOnPasswordReset）；MVP 不强制邮箱验证。
 * - **session**：DB 存储 + cookie 缓存（compact，60s）；7 天过期、24h 刷新。
 * - **rateLimit**：storage=database（serverless 安全，非 memory）；登录/注册端点自定义更严窗口。
 * - **advanced**：生产强制 Secure cookie；backgroundTasks 用 Next `after` 兜底（Vercel/ECS 皆可），
 *   保证重置邮件后台发送不阻塞响应。
 *
 * `secret` / `baseURL` 走 env（`BETTER_AUTH_SECRET` / `BETTER_AUTH_URL`），不写进 config。
 * 会话读取统一经 `lib/auth-session.ts`（DAL）；认证写操作（登录/注册/登出/重置）由
 * 客户端 `lib/auth-client.ts` 经 `/api/auth/[...all]` 路由完成，故此处不启用 `nextCookies()`
 * （DAL 只读 `getSession`，在 RSC 中写 cookie 会抛错）。
 */

const isProduction = process.env.NODE_ENV === 'production';

/** CSRF 白名单：baseURL 的 origin 自动受信，这里补充应用域；本地开发域仅非生产放行（去重、去空） */
const trustedOrigins = Array.from(
  new Set(
    [
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.BETTER_AUTH_URL,
      ...(isProduction ? [] : ['http://localhost:3000'])
    ]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
  )
);

export const auth = betterAuth({
  // 惰性建库：避免在模块加载期调用 getDb()（其无 DATABASE_URL 会抛），把连接串校验与
  // adapter 解析推迟到 betterAuth 真正解析 database 工厂时；drizzleAdapter 本身即 (options) => adapter。
  database: (options: BetterAuthOptions) =>
    drizzleAdapter(getDb(), { provider: 'pg', schema: authSchema })(options),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 256,
    // MVP 不强制邮箱验证（sendVerificationEmail 预留，未来开启）
    requireEmailVerification: false,
    // 重置令牌 1h 有效、单次使用；重置成功后吊销该用户全部会话
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: '重置你的 LV999 密码',
        text: `点击链接重置密码（1 小时内有效，仅可使用一次）：${url}`,
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
  <h2 style="font-size:18px;margin:0 0 12px">重置你的 LV999 密码</h2>
  <p style="font-size:14px;line-height:1.6;color:#444;margin:0 0 20px">
    我们收到了你的密码重置请求。点击下方按钮设置新密码，链接 1 小时内有效且仅可使用一次。
  </p>
  <a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px">重置密码</a>
  <p style="font-size:12px;line-height:1.6;color:#888;margin:20px 0 0">
    如果你没有发起此请求，可以安全地忽略这封邮件。
  </p>
</div>`
      });
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 天
    updateAge: 60 * 60 * 24, // 每 24h 刷新
    cookieCache: {
      enabled: true,
      maxAge: 60, // 会话缓存 60s：兼顾性能，并把「删用户 / 吊销后旧 cookie 仍被判有效」的窗口压到 ≤60s
      strategy: 'compact'
    }
  },
  rateLimit: {
    enabled: true,
    // database 存储：跨实例持久、重启不丢失（serverless 禁用 memory）
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      // 登录/注册端点更严（key 为剥离 basePath 后的路径）
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 }
    }
  },
  trustedOrigins,
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      sameSite: 'lax',
      httpOnly: true
    },
    backgroundTasks: {
      // Next.js `after`：请求响应后再跑后台任务（发邮件等），Vercel/ECS 均支持。
      // 不在请求作用域内（如构建期）调用会抛错，兜底为 fire-and-forget。
      handler: (promise) => {
        try {
          after(async () => {
            await promise;
          });
        } catch {
          // 非请求作用域（如构建期）after 抛错：兜底后台执行并挂 rejection handler，避免未捕获拒绝拖垮进程
          promise.catch((error) => console.warn('[auth] background task failed:', error));
        }
      }
    }
  }
});

/** 服务端会话类型（DAL / 路由复用） */
export type Session = typeof auth.$Infer.Session;
