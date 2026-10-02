'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { signIn } from '@/lib/auth-client';
import { useAppForm } from '@/lib/form';

const signInSchema = z.object({
  email: z.string().trim().min(1, '请输入邮箱').email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码')
});

interface SignInFormProps {
  /** 登录成功后的回跳目标（已由服务端 sanitize 为站内相对路径） */
  redirectUrl: string;
}

/** 邮箱 + 密码登录（Better Auth signIn.email）。错误信息原样展示——服务端对错误邮箱/密码返回一致通用消息（防枚举）。 */
export function SignInForm({ redirectUrl }: SignInFormProps) {
  const router = useRouter();

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      const { error } = await signIn.email({
        email: value.email,
        password: value.password,
        // callbackURL 用绝对 URL（email skill 要求，避免服务端推断 origin 出错）
        callbackURL: new URL(redirectUrl, window.location.origin).href
      });
      if (error) {
        toast.error(error.message || '登录失败，请检查邮箱和密码');
        return;
      }
      // 刷新 RSC 会话缓存后回跳（proxy 乐观检查此时已能读到会话 cookie）
      router.refresh();
      router.replace(redirectUrl);
    }
  });

  return (
    <div className='w-full space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='text-2xl font-semibold tracking-tight'>登录 LV999</h1>
        <p className='text-muted-foreground text-sm'>使用邮箱和密码登录你的账号</p>
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
          <form.AppField
            name='password'
            children={(field) => (
              <field.TextField
                label='密码'
                type='password'
                required
                placeholder='••••••••••••'
                autoComplete='current-password'
              />
            )}
          />
        </FieldGroup>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <LoadingButton type='submit' className='w-full' loading={isSubmitting}>
              登录
            </LoadingButton>
          )}
        </form.Subscribe>
      </form>

      <div className='text-muted-foreground space-y-3 text-center text-sm'>
        <Link
          href='/auth/forgot-password'
          className='block underline-offset-4 hover:text-foreground hover:underline'
        >
          忘记密码？
        </Link>
        <p>
          还没有账号？{' '}
          <Link
            href='/auth/sign-up'
            className='text-foreground font-medium underline-offset-4 hover:underline'
          >
            注册
          </Link>
        </p>
      </div>
    </div>
  );
}
