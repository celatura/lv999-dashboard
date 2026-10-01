import { NavGroup } from '@/types';

/**
 * Navigation configuration with RBAC support
 *
 * This configuration is used for both the sidebar navigation and Cmd+K bar.
 * Items are organized into groups, each rendered with a SidebarGroupLabel.
 *
 * RBAC Access Control:
 * Each navigation item can have an `access` property that controls visibility
 * based on permissions, plans, features, roles, and organization context.
 *
 * Examples:
 *
 * 1. Require organization:
 *    access: { requireOrg: true }
 *
 * 2. Require specific permission:
 *    access: { requireOrg: true, permission: 'org:teams:manage' }
 *
 * 3. Require specific plan:
 *    access: { plan: 'pro' }
 *
 * 4. Require specific feature:
 *    access: { feature: 'premium_access' }
 *
 * 5. Require specific role:
 *    access: { role: 'admin' }
 *
 * 6. Multiple conditions (all must be true):
 *    access: { requireOrg: true, permission: 'org:teams:manage', plan: 'pro' }
 *
 * Note: The `visible` function is deprecated but still supported for backward compatibility.
 * Use the `access` property for new items.
 */
export const navGroups: NavGroup[] = [
  {
    label: '概览',
    items: [
      {
        title: '仪表盘',
        url: '/dashboard/overview',
        icon: 'dashboard',
        isActive: false,
        shortcut: ['d', 'd'],
        items: []
      },
      {
        title: 'Agent 创作',
        url: '/dashboard/agent',
        icon: 'sparkles',
        shortcut: ['a', 'a'],
        isActive: false,
        items: []
      },
      {
        title: '技能',
        url: '/dashboard/skills',
        icon: 'badgeCheck',
        shortcut: ['s', 'k'],
        isActive: false,
        items: []
      },
      {
        title: '我的资产',
        url: '/dashboard/assets',
        icon: 'post',
        shortcut: ['a', 'p'],
        isActive: false,
        items: []
      },
      {
        title: '知识库',
        url: '/dashboard/knowledge',
        icon: 'book',
        shortcut: ['k', 'b'],
        isActive: false,
        items: []
      },
      {
        title: '设计画布',
        url: '/dashboard/design',
        icon: 'palette',
        shortcut: ['d', 's'],
        isActive: false,
        items: []
      }
    ]
  }
];
