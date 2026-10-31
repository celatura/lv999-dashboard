'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useSuspenseInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertModal } from '@/components/modal/alert-modal';
import { Button, buttonVariants } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';
import { deleteConversationMutation, updateConversationMutation } from '../../api/mutations';
import { conversationsQueryOptions } from '../../api/queries';
import type { Conversation } from '../../api/types';

/** 会话侧边栏：新建 / 切换 / 重命名 / 删除 */
export function ConversationSidebar() {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='shrink-0 p-3'>
        <Link
          href='/dashboard/agent'
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
        >
          <Icons.add /> 新建会话
        </Link>
        <div className='text-muted-foreground mt-3 flex items-center justify-between px-1 text-xs'>
          <span className='text-foreground font-medium'>会话</span>
          <span>按创建时间</span>
        </div>
      </div>
      {/* 让列表中的绝对定位元素受滚动容器约束，避免撑开页面。 */}
      <div className='relative min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
        <Suspense fallback={<SidebarSkeleton />}>
          <ConversationList />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * 窄屏（<lg）会话抽屉：桌面侧边栏隐藏时的唯一会话管理入口（切换/新建/重命名/删除）。
 * 路由变化（切换或新建会话）后自动收起；列表查询与桌面侧边栏共用同一缓存，打开即命中。
 */
export function ConversationDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant='ghost' size='icon-sm' className='lg:hidden' aria-label='会话列表' />
        }
      >
        <Icons.panelLeft className='size-4' />
      </SheetTrigger>
      <SheetContent side='left' className='gap-0 p-0'>
        <SheetHeader className='border-b px-4 py-3'>
          <SheetTitle>会话</SheetTitle>
        </SheetHeader>
        <div className='min-h-0 flex-1'>
          <Suspense fallback={<SidebarSkeleton />}>
            <ConversationSidebar />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SidebarSkeleton() {
  return (
    <div className='flex flex-col gap-1 p-1'>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className='bg-muted h-8 animate-pulse rounded-lg' />
      ))}
    </div>
  );
}

function ConversationList() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    conversationsQueryOptions()
  );
  const pathname = usePathname();
  const router = useRouter();
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<Conversation | null>(null);

  const updateMutation = useMutation(updateConversationMutation);
  const deleteMutation = useMutation(deleteConversationMutation);
  const seen = new Set<string>();
  const conversations = data.pages.flatMap((page) =>
    page.conversations.filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    })
  );
  const submitRename = () => {
    if (!renaming) return;
    const title = renameValue.trim();
    if (!title) return;
    updateMutation.mutate(
      { id: renaming.id, values: { title } },
      {
        onSuccess: () => {
          toast.success('已重命名');
          setRenaming(null);
        },
        onError: () => toast.error('重命名失败')
      }
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    const targetId = deleting.id;
    deleteMutation.mutate(targetId, {
      onSuccess: () => {
        toast.success('会话已删除');
        setDeleting(null);
        if (pathname === `/dashboard/agent/${targetId}`) {
          router.push('/dashboard/agent');
        }
      },
      onError: () => toast.error('删除失败')
    });
  };

  return (
    <>
      <nav className='flex flex-col gap-0.5'>
        {conversations.length === 0 && (
          <p className='text-muted-foreground px-2 py-3 text-xs'>
            还没有会话，点击上方「新建会话」开始创作。
          </p>
        )}
        {conversations.map((conversation) => {
          const active = pathname === `/dashboard/agent/${conversation.id}`;
          return (
            <div
              key={conversation.id}
              className={cn(
                'group flex items-center rounded-lg',
                active ? 'bg-muted' : 'hover:bg-muted/60'
              )}
            >
              <Link
                href={`/dashboard/agent/${conversation.id}`}
                className='min-w-0 flex-1 truncate px-2 py-2 text-sm'
              >
                {conversation.title}
              </Link>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      /* 桌面端悬停/键盘聚焦/菜单展开时才显形（克制的列表噪声）；窄屏无 hover，常驻 */
                      className='mr-1 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:group-has-[[aria-expanded="true"]]:opacity-100'
                    />
                  }
                >
                  <span className='sr-only'>会话操作</span>
                  <Icons.ellipsis className='size-4' />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>操作</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onClick={() => {
                        setRenaming(conversation);
                        setRenameValue(conversation.title);
                      }}
                    >
                      <Icons.edit className='mr-2 size-4' /> 重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleting(conversation)}>
                      <Icons.trash className='mr-2 size-4' /> 删除
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </nav>
      {hasNextPage && (
        <LoadingButton
          variant='ghost'
          size='sm'
          className='mt-2 w-full'
          loading={isFetchingNextPage}
          loadingLabel='正在加载更多会话'
          onClick={() => {
            void fetchNextPage({ throwOnError: true }).catch(() =>
              toast.error('加载更多会话失败，请重试')
            );
          }}
        >
          加载更多
        </LoadingButton>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>输入新的会话标题（最多 100 字）。</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              // IME 合成态下 Enter 用于确认候选词，不应触发提交
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitRename();
            }}
            placeholder='会话标题'
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              onClick={submitRename}
              disabled={updateMutation.isPending || !renameValue.trim()}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
