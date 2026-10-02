'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { resetPassword } from '@/lib/auth-client';
import { useAppForm } from '@/lib/form';

const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(12, '密码至少 12 位').max(256, '密码过长'),
    confirmPassword: z.string().min(1, '请再次输入密码')
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword']
  });

interface ResetPasswordFormProps {
  /** 从重置邮件链接带回的一次性令牌（服务端回调重定向时附加到 ?token=） */
  token: string | null;
}

/**
 * 重置密码：设置新密码（Better Auth resetPassword）。
 * 令牌无效/缺失时不渲染表单，直接提示重新申请；成功后旧会话已被服务端吊销，跳回登录页。
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();

  const form = useAppForm({
    defaultValues: { newPassword: '', confirmPassword: '' },
    validators: { onSubmit: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      if (!token) return;
      const { error } = await resetPassword({ newPassword: value.newPassword, token });
      if (error) {
        toast.error(error.message || '重置失败，链接可能已失效，请重新申请');
        return;
      }
      toast.success('密码已重置，请用新密码登录');
      router.replace('/auth/sign-in');
    }
  });

  if (!token) {
    return (
      <div className='w-full space-y-6'>
        <div className='space-y-2 text-center'>
          <h1 className='text-2xl font-semibold tracking-tight'>重置链接无效</h1>
          <p className='text-muted-foreground text-sm'>
            该密码重置链接无效或已过期，请重新申请一个新的链接。
          </p>
        </div>
        <Link
          href='/auth/forgot-password'
          className='text-foreground block text-center text-sm font-medium underline-offset-4 hover:underline'
        >
          重新申请重置链接
        </Link>
      </div>
    );
  }

  return (
    <div className='w-full space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='text-2xl font-semibold tracking-tight'>设置新密码</h1>
        <p className='text-muted-foreground text-sm'>为你的账号设置一个新密码（至少 12 位）</p>
      </div>

      <form
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <FieldGroup>
          <form.AppField
            name='newPassword'
            children={(field) => (
              <field.TextField
                label='新密码'
                type='password'
                required
                description='至少 12 位'
                placeholder='••••••••••••'
                autoComplete='new-password'
              />
            )}
          />
          <form.AppField
            name='confirmPassword'
            children={(field) => (
              <field.TextField
                label='确认新密码'
                type='password'
                required
                placeholder='••••••••••••'
                autoComplete='new-password'
              />
            )}
          />
        </FieldGroup>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <LoadingButton type='submit' className='w-full' loading={isSubmitting}>
              重置密码
            </LoadingButton>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
