import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { isAdmin } from '@/lib/admin';
import { verifySession } from '@/lib/auth-session';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'LV999',
  description: 'AI 原生的多模态创作平台',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Gate the whole /dashboard segment: redirect to sign-in when there is no valid session.
  // verifySession() 是真实安全校验（proxy 只做乐观分流）；据此服务端计算 isAdmin 注入侧边栏。
  const verified = await verifySession();
  if (!verified) redirect('/auth/sign-in');
  const admin = isAdmin(verified.userId);
  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  return (
    <KBar>
      {/* 固定高度外壳：sidebar 是 --sidebar 画布，页面是内嵌面板且唯一滚动容器，
          不再需要任何 calc(100vh - header) 的高度计算；2.375rem 图标轨两侧各留 12px */}
      <SidebarProvider
        defaultOpen={defaultOpen}
        className='h-dvh'
        style={{ '--sidebar-width-icon': '2.375rem' } as CSSProperties}
      >
        <a
          href='#main-content'
          className='bg-background ring-ring sr-only rounded-md px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:ring-2'
        >
          Skip to content
        </a>
        <AppSidebar
          isAdmin={admin}
          user={{
            name: verified.user.name,
            email: verified.user.email,
            image: verified.user.image
          }}
        />
        <SidebarInset
          id='main-content'
          tabIndex={-1}
          className='md:ring-foreground/10 min-h-0 min-w-0 overflow-hidden outline-none md:ring-1'
        >
          <Header />
          <InfobarProvider defaultOpen={false} className='min-h-0'>
            <div
              data-slot='page-scroller'
              className='flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto'
            >
              {children}
            </div>
            <InfoSidebar side='right' />
          </InfobarProvider>
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
