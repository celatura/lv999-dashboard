'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Icons } from '@/components/icons';
import { ApiError } from '@/lib/api-client';
import { deleteUserMutation } from '../api/mutations';
import type { AdminUser, DeleteUserResult } from '../api/types';

interface DeleteUserDialogProps {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 二次确认需输入的确认词：优先邮箱，无邮箱回退名称 */
function confirmToken(user: AdminUser): string {
  return user.email && user.email !== '（无邮箱）' ? user.email : user.name;
}

/** 把级联清理计数拼成一句中文摘要，供 toast 展示 */
function summarize(result: DeleteUserResult): string {
  const parts = [
    result.conversations > 0 ? `${result.conversations} 会话` : null,
    result.messages > 0 ? `${result.messages} 消息` : null,
    result.assets > 0 ? `${result.assets} 资产` : null,
    result.skills > 0 ? `${result.skills} 技能` : null,
    result.knowledgeDocuments > 0 ? `${result.knowledgeDocuments} 文档` : null,
    result.ossObjects > 0 ? `${result.ossObjects} 个 OSS 对象` : null
  ].filter(Boolean);
  return parts.length > 0 ? `已清理 ${parts.join('、')}` : '已清理相关数据';
}

function resolveDeleteError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '无权限执行此操作';
    if (error.status === 429) return '操作过于频繁，请稍后再试';
    // UI 唯一可达的 400 是「删除自己」（服务端防自删锁死）
    if (error.status === 400) return '不能删除你自己的账号';
  }
  return '删除用户失败，请稍后重试';
}

/**
 * 删除用户（不可逆）：二次确认需手动输入邮箱/名称匹配才可提交。
 * → DELETE /api/admin/users/[id] → 删 Better Auth 用户 → DB 事务级联清 7 表 → OSS 对象清理。
 */
export function DeleteUserDialog({ user, open, onOpenChange }: DeleteUserDialogProps) {
  const mutation = useMutation(deleteUserMutation);
  const [confirmText, setConfirmText] = useState('');
  const token = confirmToken(user);
  const matched = confirmText.trim() === token;

  useEffect(() => {
    if (open) setConfirmText('');
  }, [open]);

  const handleDelete = () => {
    if (!matched || mutation.isPending) return;
    mutation.mutate(user.id, {
      onSuccess: (result) => {
        toast.success(`已删除用户 ${user.name}，${summarize(result)}`);
        onOpenChange(false);
      },
      onError: (error) => toast.error(resolveDeleteError(error))
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && mutation.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='text-destructive flex items-center gap-2'>
            <Icons.warning className='size-5' />
            删除用户
          </DialogTitle>
          <DialogDescription>
            将永久删除 <span className='text-foreground font-medium'>{user.name}</span>（
            {user.email}
            ）的账号、全部业务数据（会话 / 消息 / 资产 / 知识库 / Credits）与 OSS
            对象。此操作不可撤销。
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-2'>
          <label htmlFor='delete-user-confirm' className='text-sm font-medium'>
            请输入 <span className='text-foreground font-semibold'>{token}</span> 以确认
          </label>
          <Input
            id='delete-user-confirm'
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={token}
            autoComplete='off'
            disabled={mutation.isPending}
          />
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            取消
          </Button>
          <Button
            variant='destructive'
            onClick={handleDelete}
            disabled={!matched || mutation.isPending}
          >
            {mutation.isPending ? <Icons.spinner className='animate-spin' /> : <Icons.trash />}
            永久删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
