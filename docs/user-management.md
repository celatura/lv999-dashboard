# 用户管理（管理员后台）

LV999 Dashboard 的**平台管理员后台**：管理员在 `/dashboard/admin/users` 列出全部用户、调整其 Credits、级联删除账号。取代原先「只能靠 CLI 发 Credits」的方式，配合 [Credits 消耗系统](./credits.md) 形成完整的成本管控闭环。

> 认证已从 Clerk 迁移到 **Better Auth（自托管）**（见 [docs/auth.md](./auth.md)）。用户身份数据来自本地 RDS 的 Better Auth `user` 表；本模块**零外部身份服务依赖**，列用户 / 删用户全部走本地 DB。项目核心业务全部按 `userId` 隔离、无任何 `orgId` 依赖，为单管理员模型（无多租户 / 组织）。

---

## 1. 概览

- **入口**：账号下拉菜单「用户管理」项（**仅管理员可见**，`isAdmin` 由服务端注入）；页面 `/dashboard/admin/users`。
- **能力**：列出全部用户（Better Auth `user` 身份 + Credits 余额）、调整 Credits（加/设）、级联删除账号。
- **鉴权**：`ADMIN_USER_IDS` env 白名单 + 服务端 `isAdmin` 强制校验（页面 `notFound()`、端点 403 `forbidden`）。
- **管理员同走积分**：无 `unlimited` 特权；能运行 CLI / 在白名单内即为管理员。

---

## 2. 单管理员模型（无多租户 / 组织）

项目为个人自托管、单管理员模型：`src/features` 与 `src/app/api` 全量搜索 `orgId`/`organization` **0 匹配**，`proxy.ts`（Better Auth 乐观分流）与 `dashboard/layout.tsx`（`verifySession()`）均不涉及组织——组织功能零业务依赖。历史上曾从多租户骨架移除工作区 / 团队 / OrgSwitcher 等入口；`NavItem.access` 类型保留（未来若启用 Better Auth `organization` 插件可复用，见 [docs/nav-rbac.md](./nav-rbac.md)）。

---

## 3. 管理员鉴权（[`src/lib/admin.ts`](../src/lib/admin.ts)，server-only）

```ts
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.ADMIN_USER_IDS ?? '';         // 逗号分隔的 Better Auth user id
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(userId);
}
```

- **安全默认**：`ADMIN_USER_IDS` 未配置 / 配错 → `isAdmin` 恒 false → 管理页对所有人不可达、admin 端点一律 403。
- **userId 语义**：迁移后为 **Better Auth user id**（注册后从 `user` 表或用户管理页取）；旧 Clerk userId 已失效，须用新 id 覆盖白名单。
- **服务端强制是唯一底线**：
  - 页面 [`dashboard/admin/users/page.tsx`](../src/app/dashboard/admin/users/page.tsx)：`requireUserId()` 后 `!isAdmin → notFound()`。
  - 每个 `/api/admin/*` 端点：`requireUserId()` → `!isAdmin → apiError(403, 'forbidden', …)`（[`api-error.ts`](../src/lib/api-error.ts) 的 `forbidden` code）。
- **入口可见性（仅 UX）**：[`dashboard/layout.tsx`](../src/app/dashboard/layout.tsx)（server）`const verified = await verifySession(); … const admin = isAdmin(verified.userId);` → `<AppSidebar isAdmin={admin} />` → 下拉「用户管理」项按 `isAdmin` 渲染。客户端可见性不作为权限依据。

---

## 4. 数据访问（[`features/admin/api/service.ts`](../src/features/admin/api/service.ts)，server-only）

### 4.1 列用户（查 Better Auth `user` 表 + 合并余额）

```ts
// 「最近登录」由 session 表派生（user 表无 lastSignInAt 列）
const lastActive = db
  .select({ userId: session.userId, lastSignInAt: max(session.createdAt) })
  .from(session).groupBy(session.userId).as('last_active');

const [rows, totalRows] = await Promise.all([
  db.select({ id: user.id, name: user.name, email: user.email, image: user.image,
              createdAt: user.createdAt, lastSignInAt: lastActive.lastSignInAt })
    .from(user).leftJoin(lastActive, eq(lastActive.userId, user.id))
    .where(where).orderBy(orderBy).limit(limit).offset(offset),
  db.select({ value: count() }).from(user).where(where)
]);
const balances = await getBalancesByIds(rows.map((r) => r.id)); // 批量查，避免 N+1
```

- 支持分页（`limit`/`offset`）、搜索（`query` → `ilike` email/name/id）、排序（前端 `sort` JSON 解析 → `createdAt` / `lastSignInAt`，默认 `createdAt` 倒序）。
- **余额合并**：复用 credits 的 [`getBalancesByIds`](../src/features/credits/api/service.ts)（一次 `select … where userId in (…)` 返回 `Map`），无账户行的用户按 0（与懒创建约定一致）。
- `AdminUser` = `{ id, name, email, imageUrl, createdAt, lastSignInAt, balance }`；`imageUrl` 取 `user.image`（邮箱注册通常为 null）；`name` 缺省回退邮箱前缀 → userId；`lastSignInAt` 未命中（从未登录）为 null。

---

## 5. 级联删除用户（`deleteUserCascade`，不可逆重操作）

顺序：**先断登录 → 再清数据 → 最后清对象存储**。

1. **删 Better Auth 用户**：`db.delete(user).where(eq(user.id, userId))`——`session` / `account` 外键 `ON DELETE CASCADE` 一并清理，立即断登录，防删除过程中产生新数据。**已删（重跑）则影响 0 行，幂等继续**。
2. **DB 事务**（`getDb().transaction`，全部 `where userId=`）：
   - 先收集 `assets.storageKey`（供步骤 3）与**预数 `messages`**——`messages` 无 `userId` 列，靠 `conversations` 的 `ON DELETE CASCADE` 清理，而 cascade 不回传被级联行数，故删 `conversations` 前先按其 id `count(messages)`。
   - 依次删：`knowledgeChunks`(by userId，显式) → `knowledgeDocuments`(cascade 兜底 chunks) → `assets` → `conversations`(cascade messages) → `creditLedger` → `creditsAccounts`。跨表外键均 cascade/set null，无 restrict 阻塞。
3. **OSS 清理**：逐个 `getOssClient().delete(storageKey)`，失败仅 `console.warn` 不阻塞（沿用 `deleteAsset` 模式；DB 行已删，残留对象无访问路径）。
- **返回** `DeleteUserResult`：各表删除行数（conversations/messages/assets/knowledgeDocuments/knowledgeChunks/creditLedger/creditsAccounts）+ `ossObjects`，供前端 toast 展示清理明细。
- **防自删**：端点层拒绝 `id === 当前管理员 userId`（400），避免删自己后立即断登录、失去管理入口。

---

## 6. 调整 Credits（复用 Credits 服务）

不在 admin 重写发放逻辑，直接复用 [`features/credits/api/service.ts`](../src/features/credits/api/service.ts) 的 `grantCredits`（余额 += amount）/ `setBalance`（余额 = amount），两者均写 `credit_ledger` 流水。请求体 `adjustCreditsSchema`：`{ mode:'grant'|'set', amount:int, note? }`，refine 校验 grant 需正整数、set 需非负整数。

---

## 7. API 端点（`/api/admin/*`，全部 `requireUserId()` + `isAdmin` 403 + 限流 scope `admin`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/users` | 用户列表（分页 `page`/`limit` + `query` 搜索 + `sort` 排序）+ 合并余额 |
| POST | `/api/admin/users/[id]/credits` | 调 Credits：body `{ mode, amount, note? }`（Zod 校验）→ grantCredits/setBalance → 返回新余额 |
| DELETE | `/api/admin/users/[id]` | 级联删除用户（`maxDuration=60`，长操作：删 user + 7 表事务 + 逐个 OSS）；拒绝删自己 |

- 复用 `apiError` 信封；Better Auth user id 非 uuid，校验非空即可（不用 `isUuid`）。
- 限流复用 agent 的 `checkRateLimit`，scope `admin`（防误操作刷写）。

---

## 8. 前端（`features/admin/components/`）

- **入口**：[`app-sidebar.tsx`](../src/components/layout/app-sidebar.tsx) 的 `SidebarFooter` 下拉，`isAdmin` 时显示「用户管理」`DropdownMenuItem` → `/dashboard/admin/users`（与 Credits 余额项并列）。
- **页面** `dashboard/admin/users/page.tsx`（server）：`isAdmin` 校验 → `UsersListing`（服务端预取 + `Suspense`）。
- **列表** `users-table/*`：client data-table（复用 `useDataTable` + `usersQueryOptions` + nuqs URL 状态）；列 = 用户（头像+名+邮箱）/ 注册时间 / 最近登录 / **Credits 余额** / 操作；支持搜索 + 分页 + 排序。
- **调 Credits 对话框** `adjust-credits-dialog.tsx`：TanStack Form（mode 加/设 + amount + note）；`amount` 字段用 **string** 类型（避免 number 与 undefined 的类型摩擦），提交时转 number → `POST …/credits` → 成功失效 `adminKeys.users` + credits 域。
- **删除对话框** `delete-user-dialog.tsx`：**二次确认**（输入用户邮箱/名匹配才可提交）+ 危险样式 → `DELETE …/[id]` → 成功失效列表 + toast 展示清理明细。

---

## 9. 关键约束与取舍

- **服务端鉴权是唯一安全底线**：客户端下拉可见性仅 UX；页面 `notFound()`、端点 403 才是真拦截。
- **`messages` 无 userId 列**：删用户消息只能经 `conversations` 的 cascade，不能直接 `delete messages where userId`。
- **删除不可逆**：先删 Better Auth 用户（级联 session/account 断登录）；DB 事务；OSS 失败仅告警；二次确认 + 防自删兜底。
- **余额批量查**：`getBalancesByIds`（`where userId in`）避免逐用户 N+1。
- **幂等**：删 user 影响 0 行时继续清理业务数据 / OSS，支持中断后重跑。

---

## 10. 明确延后（未实现）

停用 / 冻结（软删除，Better Auth `ban` / admin 插件）、批量调 Credits / 批量删除、用户角色权限、复杂筛选、「用户管理」进主导航（当前仅账号下拉入口；如需可用 `NavItem.access` 扩展 + `use-nav` 支持 isAdmin）、移除 CLI `credit-admin.ts`（保留为应急后备，与 Web 共用同一 service）。

---

## 11. 手动验收清单

- **鉴权**：非管理员访问 `/dashboard/admin/users` → notFound；调 admin 端点 → 403；账号下拉**不见**「用户管理」。`ADMIN_USER_IDS` 未配 → 所有人不可达。
- **列表**：管理员进入 → 全部用户 + 正确余额；搜索 / 分页 / 排序可用；「最近登录」反映 session 活跃。
- **调 Credits**：给某用户 grant 500 → 余额 +500 + `credit_ledger` 有 grant 流水；set → 余额被设定；该用户下次对话可用额度相应变化。
- **删除**：删某测试号 → `user` 表无该行（session/account 级联清空、无法登录）、业务 7 表无其数据、OSS 无其图片/视频对象、列表移除、toast 显示清理计数；删自己 → 被拒（400）。
