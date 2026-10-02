/**
 * 管理员鉴权（server-only）。
 *
 * 白名单来自 env `ADMIN_USER_IDS`（逗号分隔的 Better Auth user id）。安全默认：
 * 未配置 / 配错时 `isAdmin` 恒 false —— 管理页对所有人不可达、admin 端点一律 403。
 *
 * 服务端强制是唯一安全底线；客户端（侧边栏入口可见性）只做 UX，不作为权限依据。
 */

/** 解析白名单为去空、去重后的 userId 集合 */
function getAdminUserIds(): string[] {
  const raw = process.env.ADMIN_USER_IDS ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** 当前 userId 是否在管理员白名单内（未配置 = 无管理员，安全默认） */
export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getAdminUserIds().includes(userId);
}
