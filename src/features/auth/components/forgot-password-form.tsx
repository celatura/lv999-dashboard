'use client';

import Link from 'next/link';
import { useState } from 'react';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { requestPasswordReset } from '@/lib/auth-client';
import { useAppForm } from '@/lib/form';

const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, '请输入邮箱').email('邮箱格式不正确')
});

/**
 * 忘记密码：请求发送重置邮件（Better Auth requestPasswordReset）。
 * redirectTo 指向本站 `/auth/reset-password`（绝对 URL）——邮件链接先经服务端
 * `/api/auth/reset-password/:token` 校验，再重定向回该页并带上 `?token=`。
 *
 * 防枚举：无论邮箱是否存在，服务端都返回一致的通用结果，故这里提交后统一展示
 * 「若该邮箱已注册，重置链接已发送」，不区分成败。
 */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);

  const form = useAppForm({
    defaultValues: { email: '' },
    validators: { onSubmit: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      await requestPasswordReset({
        email: value.email,
        redirectTo: `${window.location.origin}/auth/reset-password`
      });
      // 不依据返回区分邮箱是否存在（防枚举），统一进入「已发送」态
      setSent(true);
    }
  });

  if (sent) {
    return (
      <div className='w-full space-y-6'>
        <div className='space-y-2 text-center'>
          <h1 className='text-2xl font-semibold tracking-tight'>检查你的邮箱</h1>
          <p className='text-muted-foreground text-sm'>
            如果该邮箱已注册，我们已发送密码重置链接（1
            小时内有效）。若未收到，请检查垃圾邮件或稍后重试。
          </p>
        </div>
        <Link
          href='/auth/sign-in'
          className='text-foreground block text-center text-sm font-medium underline-offset-4 hover:underline'
        >
          返回登录
        </Link>
      </div>
    );
  }

  return (
    <div className='w-full space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='text-2xl font-semibold tracking-tight'>忘记密码</h1>
        <p className='text-muted-foreground text-sm'>输入注册邮箱，我们将发送密码重置链接</p>
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
            name='email'
            children={(field) => (
              <field.TextField
                label='邮箱'
                type='email'
                required
                placeholder='you@example.com'
                autoComplete='email'
              />
            )}
          />
        </FieldGroup>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <LoadingButton type='submit' className='w-full' loading={isSubmitting}>
              发送重置链接
            </LoadingButton>
          )}
        </form.Subscribe>
      </form>

      <p className='text-muted-foreground text-center text-sm'>
        想起密码了？{' '}
        <Link
          href='/auth/sign-in'
          className='text-foreground font-medium underline-offset-4 hover:underline'
        >
          返回登录
        </Link>
      </p>
    </div>
  );
}
