'use client';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';

// 图标表达点击后的结果：展开时显示收起，收起时显示展开
export function SidebarToggle() {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  const sidebarOpen = isMobile ? openMobile : open;

  return (
    <Button
      variant='ghost'
      size='icon'
      className='text-muted-foreground hover:text-foreground -ml-1'
      aria-label='切换侧边栏'
      aria-expanded={sidebarOpen}
      onClick={toggleSidebar}
    >
      {sidebarOpen ? <Icons.panelLeftClose /> : <Icons.panelLeftOpen />}
    </Button>
  );
}
