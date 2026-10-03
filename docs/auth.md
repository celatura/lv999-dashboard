# 认证（Better Auth 自托管）

> 本项目认证采用 **Better Auth（自托管）**：登录 / 注册 / 会话 / 密码重置全部跑在自有服务器 + RDS，用户数据不出境，国内访问无需连国外域名。
>
> 依赖：`better-auth` + `nodemailer`（重置邮件）。认证表由 `npx auth generate` 产出、经 drizzle 迁移落库。

---

## 1. 架构总览

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 服务端配置 | [`src/lib/auth.ts`](../src/lib/auth.ts) | `betterAuth()` 实例：drizzleAdapter + emailAndPassword + session + rateLimit + trustedOrigins + backgroundTasks |
| 路由 | [`src/app/api/auth/[...all]/route.ts`](../src/app/api/auth/%5B...all%5D/route.ts) | `toNextJsHandler(auth)` 挂载全部认证端点（Node runtime） |
| DB schema | [`src/lib/db/auth-schema.ts`](../src/lib/db/auth-schema.ts) | `npx auth generate` 产出的 user / session / account / verification / rate_limit 五表 |
| 客户端 | [`src/lib/auth-client.ts`](../src/lib/auth-client.ts) | `createAuthClient()`（`better-auth/react`）：signIn / signUp / signOut / useSession / updateUser / changePassword / requestPasswordReset / resetPassword |
| **DAL** | [`src/lib/auth-session.ts`](../src/lib/auth-session.ts) | **服务端会话读取单一入口**：`verifySession()` / `requireUserId()`（React `cache()` 去重） |
| 邮件 | [`src/lib/mailer.ts`](../src/lib/mailer.ts) | nodemailer + SMTP，用于密码重置邮件（未配置 SMTP 时告警跳过，不阻塞） |
| 代理 | [`src/proxy.ts`](../src/proxy.ts) | Edge 乐观分流：无会话 cookie → 重定向登录页（**非安全边界**） |

**职责分离**：认证**写操作**（登录 / 注册 / 登出 / 改资料 / 改密码 / 重置）由客户端 `auth-client` 经 `/api/auth/[...all]` HTTP 路由完成；服务端只**读取**会话（DAL 的 `getSession`）。因此 `auth.ts` **不启用 `nextCookies()` 插件**——DAL 在 RSC 中只读，写 cookie 会抛错。

---

## 2. Data Access Layer（DAL）—— 会话读取单点

所有服务端代码（Route Handler / server 页 / listing）统一经 DAL 取当前用户：

```ts
import { verifySession, requireUserId } from '@/lib/auth-session';

// Route Handler：保留原有 401 信封语义
const userId = await requireUserId(); // string | null（未登录返回 null，不抛错）
if (!userId) return apiError(401, 'unauthorized', 'Unauthorized');

// server 页 / layout：需要完整用户对象时
const verified = await verifySession(); // { userId, user, session } | null
if (!verified) redirect('/auth/sign-in');
```

- `verifySession()`：`auth.api.getSession({ headers: await headers() })` + React `cache()`，同一请求内多次调用只查一次（cookieCache 命中时甚至不查 DB）。
- `requireUserId()`：只取 userId，**刻意返回 `null` 而非抛错**，让调用方原有的 `if (!userId)` 分支（401 / notFound / 空渲染）逐字不变。
- `verifySessionAuthoritative()` / `requireUserIdAuthoritative()`：带 `disableCookieCache: true` 强制回源 DB，绕过 cookieCache ≤60s 窗口——用于「吊销即时性」敏感的判权（`/api/admin/*` 端点）。普通只读列表仍用 `verifySession()` 享受缓存。
- 收益：未来更换认证实现或加缓存只改这一处。

---

## 3. 路由保护

- **`proxy.ts`（Edge，乐观分流）**：`getSessionCookie(request)` 仅检查会话 cookie 是否存在（纯字符串解析，不查 DB / 不验签），无则重定向 `/auth/sign-in?redirect_url=<原路径>`。matcher 仅 `/dashboard/:path*`。⚠️ cookie 存在 ≠ 会话有效，**不可当安全边界**。
- **`dashboard/layout.tsx`（真实校验）**：`verifySession()` 无有效会话则 `redirect('/auth/sign-in')`；据此服务端计算 `isAdmin` 并把 user 注入侧边栏。
- **各 API 路由**：`requireUserId()` 为空返回 401；归属即权限（越权返回 404）。`/api/admin/*` 用 `requireUserIdAuthoritative()`（强制回源 DB，规避 ≤60s 吊销残留）。
- **登录 / 注册页**：已登录访问 → `verifySession()` 命中则回跳目标（避免登录态停留登录页）。

---

## 4. 数据模型与 userId 语义

Better Auth 五表（`auth-schema.ts`）：`user`（id/email/name/image/emailVerified/createdAt/updatedAt）、`session`、`account`、`verification`、`rate_limit`（rateLimit storage=database 用）。

- **业务表 userId 语义**：conversations / assets / knowledge / credits / skills 的 `userId`(text) 为 **Better Auth user id**（列类型不变）。
- **`ADMIN_USER_IDS`**：值为 Better Auth user id（注册后从 `user` 表或用户管理页取）；机制为 env 白名单 + [`isAdmin`](../src/lib/admin.ts)。

---

## 5. 认证 UI（自建）

品牌外壳 [`auth-shell.tsx`](../src/features/auth/components/auth-shell.tsx)（InteractiveGridPattern 侧栏）+ shadcn Field + TanStack Form + zod：

| 页面 | 路由 | 表单 | 客户端方法 |
| --- | --- | --- | --- |
| 登录 | `/auth/sign-in` | [`sign-in-form.tsx`](../src/features/auth/components/sign-in-form.tsx) | `signIn.email`（callbackURL 绝对 URL） |
| 注册 | `/auth/sign-up` | [`sign-up-form.tsx`](../src/features/auth/components/sign-up-form.tsx) | `signUp.email`（email + name + password，min 12） |
| 忘记密码 | `/auth/forgot-password` | [`forgot-password-form.tsx`](../src/features/auth/components/forgot-password-form.tsx) | `requestPasswordReset`（redirectTo 绝对 URL） |
| 重置密码 | `/auth/reset-password` | [`reset-password-form.tsx`](../src/features/auth/components/reset-password-form.tsx) | `resetPassword`（token 由页面从 `?token=` 注入） |

- 登录成功：`router.refresh()` + `router.replace(redirectUrl)`（回跳原路径）。
- 侧边栏 / 个人资料：user 由服务端会话注入（无客户端二次拉取，无头像闪烁）；登出走 `signOut()`。
- 个人资料页 [`profile-settings.tsx`](../src/features/profile/components/profile-settings.tsx)：头像（上传 / 更换 / 删除，见 §5.1）+ 改名字（`updateUser`）+ 改密码（`changePassword`，`revokeOtherSessions`）+ 登出；邮箱只读（改邮箱需二次验证，延后）。

**密码重置流程**：`requestPasswordReset({ email, redirectTo })` → 服务端发信，链接为 `<baseURL>/api/auth/reset-password/<token>?callbackURL=<redirectTo>` → 用户点击 → 服务端校验 token 后重定向到 `redirectTo?token=<token>`（即 `/auth/reset-password`）→ 页面读 token → `resetPassword({ newPassword, token })` → 旧会话全部失效 → 跳登录页。

---

## 5.1 用户头像（上传 / 代理 / 即时生效）

Better Auth 注册不带头像，`user.image` 恒空 → 全站首字母占位。头像功能补上**写入链路**（展示链路本就就绪），零新增依赖、无 DB 迁移（`user.image` 列已存在）、零 Credits（纯存储）。

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| 存储 key | [`oss.ts` `avatarObjectKey`](../src/lib/oss.ts) | OSS 私有桶 `avatars/{userId}.png`，**单 key 覆盖写**（换头像即覆盖，无版本累积） |
| 服务端处理 | [`features/profile/lib/avatar.ts`](../src/features/profile/lib/avatar.ts) | `normalizeAvatar`（sharp 256×256 cover → png）+ `commitUserImage`（updateUser 写回 + 转发 cookie） |
| 上传 / 删除 | [`POST` / `DELETE /api/user/avatar`](../src/app/api/user/avatar/route.ts) | userId **只取自会话**（`requireUserIdAuthoritative`，防越权）；限流 scope `avatar` 10/分 |
| 代理展示 | [`GET /api/avatar/[userId]`](../src/app/api/avatar/%5BuserId%5D/route.ts) | 登录即可（头像半公开）；签名拉 OSS → 同源回传字节 + `Cache-Control: private, max-age=300`；无对象 → 404 |
| 前端入口 | [`avatar-card.tsx`](../src/features/profile/components/avatar-card.tsx) | 预览 + 上传 / 更换 + 删除（确认）；成功后乐观更新 src（`?v=` 破缓存）+ `router.refresh()` |

**上传流程**：`formData` 取 file → 校验（`File` 实例 / ≤5MB / mime 粗筛 / `detectImageType` 魔数防改扩展名）→ sharp 规格化 → `putObject` 覆盖写 → `commitUserImage('/api/avatar/{userId}')` → 返回 `{ image }`。

**`user.image` 存同源代理路径**（`/api/avatar/{userId}`）而非 OSS 签名 URL：签名 URL 会过期、且需对象公开读（安全风险）；代理路径永不过期、桶保持私有，复用资产 `/raw` 成熟模式。

**即时生效的关键（规避 ≤60s cookieCache）**：`updateUser` 内部 `setSessionCookie` 会重签携带新 user 数据的 session cookie，但从 Route Handler 直接调用只拿到返回体、**拿不到 cookie**——故 `commitUserImage` 以 `asResponse: true` 取出响应并**转发其 `Set-Cookie`** 给浏览器，浏览器才立即用新值覆盖 cookieCache。若绕开 Better Auth 直接 Drizzle 改库，则服务端 `verifySession()`（读 cookieCache）最长 ≤60s 仍旧值。

**设置 / 删除对称走 `updateUser`**：`updateUser` 原生支持 `image: null`（透传 `internalAdapter.updateUser` 置空），故删除同样即时、各处一致回退首字母，无需为 null 语义绕 Drizzle。

**展示零改动**：侧边栏 [`user-avatar-profile.tsx`](../src/components/user-avatar-profile.tsx)、管理页 [`users-table/columns.tsx`](../src/features/admin/components/users-table/columns.tsx)、[`dashboard/layout.tsx`](../src/app/dashboard/layout.tsx) 服务端注入均读 `user.image`（`AvatarImage` + 首字母回退）——写入后全部自动生效；代理 404 时 `AvatarImage` 自然回退 `AvatarFallback`。

---

## 6. 用户管理后台（查本地 DB）

[`features/admin/api/service.ts`](../src/features/admin/api/service.ts)：

- **`listUsers`**：查 Better Auth `user` 表（分页 + 搜索 email/name/id + 排序 createdAt）+ 合并 `credits_accounts` 余额（批量查避免 N+1）。「最近登录」由 `session` 表派生（`max(session.createdAt)` 子查询 leftJoin，user 表无 lastSignInAt 列）。
- **`deleteUserCascade`**：**单个 DB 事务原子**依次删 ① Better Auth `user`（`session`/`account` 外键 ON DELETE CASCADE 断登录）+ ② 业务 8 表（conversations / messages(级联) / assets / **skills**（无外键须显式删）/ knowledge_documents / knowledge_chunks / credit_ledger / credits_accounts）——任一步失败整体回滚、可安全重跑；事务提交后再 ③ 清 OSS 对象（失败仅告警）。注：DB 会话即时失效，但被删/吊销用户凭 cookie 缓存最长 ≤60s 仍可能通过旧请求（见 §7 cookieCache）。
- 端点 / 鉴权（isAdmin 403）/ 限流不变。

---

## 7. 安全配置（`auth.ts`）

- `BETTER_AUTH_SECRET`（≥32 字符高熵，走 env，不入 config / Git）；生产拒绝占位 secret。
- `baseURL` 走 `BETTER_AUTH_URL`（生产 HTTPS）；`trustedOrigins` = 应用域 + `BETTER_AUTH_URL`（生产）；`localhost:3000` 仅非生产放行（去重）。
- `rateLimit`：`enabled` + `storage: 'database'`（serverless 安全，非 memory）+ `customRules`（`/sign-in/email` 5/分、`/sign-up/email` 3/分）。
- CSRF 保持开启（未设 `disableCSRFCheck`）；origin 校验保持。
- Cookie：`useSecureCookies` 按 `BETTER_AUTH_URL` scheme 判定（https→true，未设回退 NODE_ENV），比只看 NODE_ENV 更稳；`sameSite: lax`、`httpOnly`。
- 反代 IP：`advanced.ipAddress.ipAddressHeaders = ['x-forwarded-for', 'x-real-ip']`（+ `ipv6Subnet: 64`）——Nginx 须以 `X-Real-IP $remote_addr` 下发单值真实 IP；多跳 XFF 需再配 `trustedProxies`，否则生产限流会退化到全站共享单桶（Better Auth 自带告警）。
- Session：DB 存储 + `cookieCache`（compact，**60s**——兼顾性能与「吊销即时性」：删用户 / 重置后旧 cookie 最多 60s 内仍可能被判有效）；`expiresIn` 7 天、`updateAge` 24h；`revokeSessionsOnPasswordReset: true`。
- 密码：默认 **scrypt**（Node 原生，无额外原生依赖）；`minPasswordLength: 12`。
- `backgroundTasks.handler`：Next.js `after`（Vercel / ECS 皆可），重置邮件后台发不阻塞响应。
- 防枚举：依赖内置一致响应（错误邮箱 / 错误密码返回通用消息，不自写「用户不存在」文案）。

---

## 8. 环境变量

```env
# 认证
BETTER_AUTH_SECRET=        # openssl rand -base64 32
BETTER_AUTH_URL=           # 生产 HTTPS；本地 http://localhost:3000

# SMTP（密码重置邮件；未配置则重置不可用，不影响登录/注册）
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# 管理员白名单（Better Auth user id，逗号分隔；留空 = 无管理员）
ADMIN_USER_IDS=
```

---

## 9. Schema 迁移工作流

认证表随业务表复用同一套 drizzle 迁移流程（`drizzle.config.ts` 的 `schema` 已并入 `auth-schema.ts`）：

```bash
# 加插件或改认证字段后，重新生成 auth-schema（会覆盖，需先临时移除 auth.ts / mailer.ts 的 `import 'server-only'`）
npx auth@latest generate --output src/lib/db/auth-schema.ts

# 生成迁移 SQL（不连库）→ 应用到 RDS（沿用项目确定性工作流，见 scripts/db-apply-sql.ts）
bunx drizzle-kit generate
bun scripts/db-apply-sql.ts
```

> ⚠️ 加插件（2FA / organization 等）须重跑 `auth generate` 并重新迁移；本 MVP 无插件。
>
> ⚠️ **手动时区调整**：`auth-schema.ts` 所有 `timestamp` 列已改为 `{ withTimezone: true }`（timestamptz，与业务表一致，消除跨时区过期漂移，如重置令牌恒失效）。重跑 `auth generate` 会把它覆盖回无时区版——覆盖后须重新补 `withTimezone: true` 并再跑 `drizzle-kit generate` + `db-apply-sql` 迁移列类型。

---

## 10. 验证

- `GET /api/auth/ok` → `{"ok":true}`。
- `GET /api/auth/get-session`（无 cookie）→ `null`；注册 / 登录后带 cookie → 完整 session。
- 未登录访问 `/dashboard` → 重定向 `/auth/sign-in?redirect_url=...`；登录后回跳原路径。
- DevTools network：登录 / 会话全程无国外域名请求。
