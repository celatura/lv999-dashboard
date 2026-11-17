'use client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar
} from '@/components/ui/sidebar';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import { navGroups } from '@/config/nav-config';
import { signOut } from '@/lib/auth-client';
import { useFilteredNavGroups } from '@/hooks/use-nav';
import { cn } from '@/lib/utils';
import { SidebarCreditsItem } from '@/features/credits/components/sidebar-credits-item';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { Icons } from '../icons';

interface AppSidebarProps {
  /** 是否平台管理员：由 dashboard/layout.tsx 服务端计算后注入，仅控制「用户管理」入口可见性（UX，非权限依据） */
  isAdmin?: boolean;
  /** 当前登录用户展示信息：由 dashboard/layout.tsx 服务端会话注入，避免客户端再拉一次 get-session（无头像闪烁） */
  user?: { name: string; email: string; image?: string | null } | null;
}

/** 前缀匹配：/dashboard/agent/[conversationId] 等子路由也要点亮父级导航项 */
function isActivePath(pathname: string, url: string) {
  return pathname === url || (url !== '/' && url !== '#' && pathname.startsWith(`${url}/`));
}

// 2.375rem 图标轨配 4px 左右内边距，32px 按钮两侧各留 12px
const railPadding = 'group-data-[collapsible=icon]:px-1';

export default function AppSidebar({ isAdmin = false, user = null }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile, isMobile, state } = useSidebar();
  const filteredGroups = useFilteredNavGroups(navGroups);
  // 移动端抽屉点击导航后需要主动关闭（桌面图标轨不受影响）
  const closeMobile = () => setOpenMobile(false);
  // 折叠成图标轨后账号菜单改为向右弹出，避免盖住导轨
  const railMenu = state === 'collapsed' && !isMobile;
  // 账号下拉受控 open：打开时才查 Credits 余额（不常驻轮询）
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);

  return (
    <Sidebar collapsible='icon' variant='inset'>
      <SidebarHeader className={railPadding}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              render={<Link href='/dashboard/overview' aria-label='LV999' />}
            >
              <div className='bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg'>
                <Icons.logo className='size-4' />
              </div>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>LV999</span>
                <span className='text-muted-foreground truncate text-xs'>AI 创作平台</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {filteredGroups.map((group) => (
          <SidebarGroup key={group.label || 'ungrouped'} className={cn('py-0', railPadding)}>
            {group.label && (
              // 图标轨模式下分组标题被 -mt-8 上移隐藏，不加 pointer-events-none 会挡住上方导航项的点击
              <SidebarGroupLabel className='group-data-[collapsible=icon]:pointer-events-none'>
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarMenu className='gap-0.5'>
              {group.items.map((item) => {
                const Icon = item.icon ? Icons[item.icon] : Icons.logo;
                const active = isActivePath(pathname, item.url);
                return item?.items && item?.items?.length > 0 ? (
                  <Collapsible
                    key={item.title}
                    defaultOpen={item.isActive || active}
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          tooltip={item.title}
                          isActive={active}
                          className='group/collapsible'
                        />
                      }
                    >
                      {item.icon && <Icon />}
                      <span>{item.title}</span>
                      <Icons.chevronRight className='ml-auto transition-transform duration-200 group-data-panel-open/collapsible:rotate-90' />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items?.map((subItem) => {
                          const subActive = isActivePath(pathname, subItem.url);
                          return (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton
                                render={
                                  <Link
                                    href={subItem.url}
                                    aria-label={subItem.title}
                                    aria-current={subActive ? 'page' : undefined}
                                  />
                                }
                                isActive={subActive}
                                onClick={closeMobile}
                              >
                                <span>{subItem.title}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      render={
                        <Link
                          href={item.url}
                          aria-label={item.title}
                          aria-current={active ? 'page' : undefined}
                        />
                      }
                      tooltip={item.title}
                      isActive={active}
                      onClick={closeMobile}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className={railPadding}>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size='lg'
                    className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
                  />
                }
              >
                {user && <UserAvatarProfile className='size-8 rounded-lg' showInfo user={user} />}
                <Icons.chevronsUpDown className='text-muted-foreground ml-auto size-4' />
              </DropdownMenuTrigger>
              {/* 桌面端向右弹出：展开时距侧栏 8px，图标轨时 16px；移动端在抽屉内向上弹出 */}
              <DropdownMenuContent
                className={isMobile ? 'w-(--anchor-width) min-w-60' : 'w-64'}
                side={isMobile ? 'top' : 'right'}
                align={isMobile ? 'start' : 'end'}
                sideOffset={isMobile ? 4 : railMenu ? 16 : 8}
                alignOffset={isMobile ? 0 : -8}
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className='p-0 font-normal'>
                    <div className='px-1 py-1.5'>
                      {user && (
                        <UserAvatarProfile className='h-8 w-8 rounded-lg' showInfo user={user} />
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <SidebarCreditsItem enabled={userMenuOpen} />
                  <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
                    <Icons.account className='mr-2 h-4 w-4' />
                    个人资料
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => router.push('/dashboard/admin/users')}>
                      <Icons.teams className='mr-2 h-4 w-4' />
                      用户管理
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={async () => {
                      await signOut();
                      router.refresh();
                      router.push('/auth/sign-in');
                    }}
                  >
                    <Icons.logout aria-hidden className='mr-2 h-4 w-4' />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail className='hover:after:bg-transparent' />
    </Sidebar>
  );
}
