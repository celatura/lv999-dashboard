'use client';
import React from 'react';
import { ActiveThemeProvider } from '../themes/active-theme';
import QueryProvider from './query-provider';

export default function Providers({
  activeThemeValue,
  children
}: {
  activeThemeValue: string;
  children: React.ReactNode;
}) {
  // Better Auth 无全局 Provider：认证状态由 `lib/auth-client` 的 useSession 按需订阅，
  // 会话 cookie 由 /api/auth/[...all] 路由管理。此处仅保留主题与 React Query Provider。
  return (
    <ActiveThemeProvider initialTheme={activeThemeValue}>
      <QueryProvider>{children}</QueryProvider>
    </ActiveThemeProvider>
  );
}
