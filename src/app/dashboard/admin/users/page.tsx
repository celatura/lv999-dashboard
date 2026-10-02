import { notFound } from 'next/navigation';
import { requireUserId } from '@/lib/auth-session';
import PageContainer from '@/components/layout/page-container';
import { isAdmin } from '@/lib/admin';
import { searchParamsCache } from '@/lib/searchparams';
import UsersListing from '@/features/admin/components/users-listing';
import type { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: 用户管理',
  robots: { index: false, follow: false }
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

/**
 * 管理员用户管理页。
 * 服务端强制校验 isAdmin：非管理员一律 notFound()（不泄露管理页存在），这是唯一安全底线；
 * 侧边栏入口可见性只是 UX。校验通过后解析 URL 状态并渲染 UsersListing（服务端预取 + Suspense）。
 */
export default async function AdminUsersPage(props: PageProps) {
  const userId = await requireUserId();
  if (!isAdmin(userId)) notFound();

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='用户管理'
      pageDescription='列出全部注册用户，调整其 Credits 余额或删除账号（删除会级联清理业务数据与 OSS 对象）。'
    >
      <UsersListing />
    </PageContainer>
  );
}
