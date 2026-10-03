# 导航可见性与权限控制

## 现状（单管理员模型）

项目为个人自托管、单管理员模型，不使用多租户 / 组织。导航的 **org-based RBAC**
（`requireOrg` / `permission` / `role`）在当前部署下不生效：[`use-nav.ts`](../src/hooks/use-nav.ts)
为纯同步过滤，不调用任何 org / 会话 hook。org 上下文恒为「无组织」（`hasOrg=false`），
故带这些 `access` 的导航项隐藏。

## 导航可见性（纯客户端 UX）

- [`nav-config.ts`](../src/config/nav-config.ts) 声明导航项（分组 + 可选 `access`）。
- [`use-nav.ts`](../src/hooks/use-nav.ts) 的 `useFilteredNavItems` / `useFilteredNavGroups` 同步过滤
  （零服务端调用、无加载态、无闪烁），被侧边栏（`app-sidebar.tsx`）与 kbar 共用。
- 当前所有导航项均**无 `access`**（全部可见）；`NavItem.access` 类型保留供未来。
- **导航可见性仅是 UX 层，不是安全边界**——用户无法靠看到/隐藏菜单项绕过任何校验。

## 真正的权限控制（服务端强制）

| 层 | 机制 |
| --- | --- |
| 登录 | `dashboard/layout.tsx` 的 `verifySession()`（未登录重定向 sign-in；见 [docs/auth.md](./auth.md)）|
| 管理员 | `ADMIN_USER_IDS` env 白名单 + [`isAdmin()`](../src/lib/admin.ts) 服务端校验：管理页 `notFound()`、`/api/admin/*` 端点 403 `forbidden`。见 [docs/user-management.md](./user-management.md) |
| 资源归属 | 各 service 层按 `userId` 过滤（越权与不存在同返回 undefined，不泄漏存在性）|

任何敏感操作的安全校验必须在服务端完成；客户端导航过滤**不可**作为权限依据。

## 若未来重新启用组织 / 多租户

Better Auth 提供 `organization` 插件（本项目 MVP 未启用）。恢复 org-based RBAC 需：① 启用 Better Auth organization 插件并迁移其 schema；
② `use-nav.ts` 引入会话 / 成员查询读取 `permissions` / `role` 填充 access 上下文；
③ nav-config 相应项加 `access: { requireOrg / permission / role }`。
在此之前，org 维度的 `access` 恒不满足（对应导航项隐藏），属预期行为。
