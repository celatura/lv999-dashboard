'use client';

/**
 * 导航可见性过滤（纯客户端，UX only）。
 *
 * 历史：本 hook 曾用认证方的组织 hook 做 org-based RBAC（requireOrg / permission / role）。
 * 项目为个人自托管、单管理员模型，不使用多租户 / 组织（认证已迁移 Better Auth，未启用
 * organization 插件），org 上下文不复存在，故 org 数据源移除（恒为无组织），
 * requireOrg / permission / role 的导航项在当前部署下隐藏。
 * 真正的权限控制由服务端 `isAdmin`（ADMIN_USER_IDS 白名单）承担，见 docs/user-management.md。
 *
 * Performance:
 * - All checks are synchronous (no server calls)
 * - Instant filtering
 * - No loading states
 * - No UI flashing
 *
 * Note: For actual security (API routes, server actions), always use server-side checks.
 * This is only for UI visibility.
 */

import { useMemo } from 'react';
import type { NavItem, NavGroup } from '@/types';

/**
 * 无组织上下文（单管理员模型，未启用组织功能）：org-based access 恒不满足。
 * hasOrg=false → requireOrg / permission / role 的导航项隐藏；无 access 的项正常显示。
 */
const ACCESS_CONTEXT = {
  hasOrg: false,
  permissions: [] as string[],
  role: undefined as string | undefined
};

/**
 * Hook to filter navigation items based on RBAC (fully client-side)
 *
 * @param items - Array of navigation items to filter
 * @returns Filtered items
 */
export function useFilteredNavItems(items: NavItem[]) {
  const accessContext = ACCESS_CONTEXT;

  // Filter items synchronously (all client-side)
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        // No access restrictions
        if (!item.access) {
          return true;
        }

        // Check requireOrg
        if (item.access.requireOrg && !accessContext.hasOrg) {
          return false;
        }

        // Check permission
        if (item.access.permission) {
          if (!accessContext.hasOrg) {
            return false;
          }
          if (!accessContext.permissions.includes(item.access.permission)) {
            return false;
          }
        }

        // Check role
        if (item.access.role) {
          if (!accessContext.hasOrg) {
            return false;
          }
          if (accessContext.role !== item.access.role) {
            return false;
          }
        }

        // Note: Plans and features require server-side checks (not client-side nav filtering)
        // For navigation visibility, you can either:
        // 1. Store plan/feature info in organization metadata (client-accessible)
        // 2. Use server actions (current approach)
        // 3. Skip plan/feature checks for navigation (recommended for performance)

        // For now, if plan/feature is specified, we'll need to handle it differently
        // Most navigation items won't need plan/feature checks anyway
        if (item.access.plan || item.access.feature) {
          // Option: Return true and let the page handle it, or use server action
          // For now, we'll show it (page-level protection should handle it)
          console.warn(
            `Plan/feature checks for navigation items require server-side verification. ` +
              `Item "${item.title}" will be shown, but page-level protection should be implemented.`
          );
        }

        return true;
      })
      .map((item) => {
        // Recursively filter child items
        if (item.items && item.items.length > 0) {
          const filteredChildren = item.items.filter((childItem) => {
            // No access restrictions
            if (!childItem.access) {
              return true;
            }

            // Check requireOrg
            if (childItem.access.requireOrg && !accessContext.hasOrg) {
              return false;
            }

            // Check permission
            if (childItem.access.permission) {
              if (!accessContext.hasOrg) {
                return false;
              }
              if (!accessContext.permissions.includes(childItem.access.permission)) {
                return false;
              }
            }

            // Check role
            if (childItem.access.role) {
              if (!accessContext.hasOrg) {
                return false;
              }
              if (accessContext.role !== childItem.access.role) {
                return false;
              }
            }

            // Plan/feature checks (same warning as above)
            if (childItem.access.plan || childItem.access.feature) {
              console.warn(
                `Plan/feature checks for navigation items require server-side verification. ` +
                  `Item "${childItem.title}" will be shown, but page-level protection should be implemented.`
              );
            }

            return true;
          });

          return {
            ...item,
            items: filteredChildren
          };
        }

        return item;
      });
  }, [items, accessContext]);

  return filteredItems;
}

/**
 * Hook to filter navigation groups based on RBAC (fully client-side)
 *
 * @param groups - Array of navigation groups to filter
 * @returns Filtered groups (empty groups are removed)
 */
export function useFilteredNavGroups(groups: NavGroup[]) {
  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const filteredItems = useFilteredNavItems(allItems);

  return useMemo(() => {
    const filteredSet = new Set(filteredItems.map((item) => item.title));
    return groups
      .map((group) => ({
        ...group,
        items: filteredItems.filter((item) =>
          group.items.some((gi) => gi.title === item.title && filteredSet.has(gi.title))
        )
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, filteredItems]);
}
