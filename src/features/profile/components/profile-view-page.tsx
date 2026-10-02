import { redirect } from 'next/navigation';
import PageContainer from '@/components/layout/page-container';
import { verifySession } from '@/lib/auth-session';
import { ProfileSettings } from './profile-settings';

/** 个人资料页：服务端读取会话，把当前 name/email 注入客户端设置组件（改名字 / 改密码 / 登出）。 */
export default async function ProfileViewPage() {
  const verified = await verifySession();
  if (!verified) redirect('/auth/sign-in');

  return (
    <PageContainer pageTitle='个人资料' pageDescription='管理你的账号信息与登录密码。'>
      <ProfileSettings name={verified.user.name} email={verified.user.email} />
    </PageContainer>
  );
}
