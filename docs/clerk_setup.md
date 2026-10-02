# Clerk 配置指南

> ⚠️ **已废弃（DEPRECATED）**：本项目认证已从 Clerk 迁移到 **Better Auth（自托管）**。最新的认证架构 / 配置 / 安全清单见 [docs/auth.md](./auth.md)。以下 Clerk 内容仅作历史留存，不再适用。

本指南涵盖本项目中使用的 Clerk 功能的设置与配置。

## 所需的 Clerk 权限范围

- **Authentication（认证）** - 用户登录/注册与会话管理
- **Backend API（后端 API）** - 管理员用户管理后台经 `clerkClient()` 调用 `users.getUserList` / `users.deleteUser`（用已有 `CLERK_SECRET_KEY` 认证，无需额外配置）

> **Organizations（组织 / 多租户）已移除**：本项目定位个人自托管，核心业务全部按 `userId` 隔离，不再使用工作区 / 团队功能。如需重新启用，可在 Clerk Dashboard > Organizations settings 开启并配置默认角色，参见 [Clerk Organizations 文档](https://clerk.com/docs/organizations/overview)（对本项目为可选，无需配置）。

## 管理员用户管理后台

平台管理员可在 `/dashboard/admin/users` 列出全部用户、调整其 Credits、级联删除账号（Clerk + 业务数据 + OSS）。

### 配置管理员白名单：

1. 取你自己的 Clerk userId：Clerk Dashboard > Users 查看，或登录后从服务端 `auth().userId` 读取
2. 在 `.env.local` 配置 `ADMIN_USER_IDS`（逗号分隔，可多个）：`ADMIN_USER_IDS=user_2abcDEF123456`
3. 命中白名单的账号，账号下拉会出现「用户管理」入口

> **安全默认**：`ADMIN_USER_IDS` 留空 = 无管理员，管理页对所有人 `notFound()`、`/api/admin/*` 一律 403。鉴权在服务端强制执行（`src/lib/admin.ts` 的 `isAdmin`），客户端入口可见性仅为 UX。

### 导航 RBAC 系统（保留）：

- 完全客户端的导航过滤，使用 `useNav` hook；支持 `requireOrg`、`permission` 和 `role` 检查（全部客户端，即时生效）
- 在 `src/config/nav-config.ts` 中通过 `access` 属性配置；详细文档请参见 `docs/nav-rbac.md`
- 组织功能移除后暂无使用 `access` 的菜单项，框架保留备用（无副作用）；真正的安全校验始终在服务端

### 更多信息，请参见：

- [Clerk 文档](https://clerk.com/docs)
- [Clerk Backend API 参考](https://clerk.com/docs/reference/backend-api)
