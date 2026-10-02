'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as z from 'zod';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { signUp } from '@/lib/auth-client';
import { useAppForm } from '@/lib/form';

const signUpSchema = z.object({
  name: z.string().trim().min(1, '请输入你的名字').max(50, '名字过长'),
  email: z.string().trim().min(1, '请输入邮箱').email('邮箱格式不正确'),
  password: z.string().min(12, '密码至少 12 位').max(256, '密码过长')
});

interface SignUpFormProps {
  /** 注册成功后的回跳目标（已由服务端 sanitize 为站内相对路径） */
  redirectUrl: string;
}

/** 邮箱 + 名字 + 密码注册（Better Auth signUp.email），成功后自动登录并回跳。 */
export function SignUpForm({ redirectUrl }: SignUpFormProps) {
  const router = useRouter();

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '' },
    validators: { onSubmit: signUpSchema },
    onSubmit: async ({ value }) => {
      const { error } = await signUp.email({
        name: value.name.trim(),
        email: value.email,
        password: value.password,
        callbackURL: new URL(redirectUrl, window.location.origin).href
      });
      if (error) {
        // 邮箱已注册等情况：原样展示服务端通用消息（防枚举）
        toast.error(error.message || '注册失败，请稍后重试');
        return;
      }
      router.refresh();
      router.replace(redirectUrl);
    }
  });

  return (
    <div className='w-full space-y-6'>
      <div className='space-y-2 text-center'>
        <h1 className='text-2xl font-semibold tracking-tight'>创建账号</h1>
        <p className='text-muted-foreground text-sm'>注册后即可使用 LV999 的全部创作能力</p>
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
            name='name'
            children={(field) => (
              <field.TextField label='名字' required placeholder='你的名字' autoComplete='name' />
            )}
          />
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
                description='至少 12 位'
                placeholder='••••••••••••'
                autoComplete='new-password'
              />
            )}
          />
        </FieldGroup>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <LoadingButton type='submit' className='w-full' loading={isSubmitting}>
              注册
            </LoadingButton>
          )}
        </form.Subscribe>
      </form>

      <p className='text-muted-foreground text-center text-sm'>
        已有账号？{' '}
        <Link
          href='/auth/sign-in'
          className='text-foreground font-medium underline-offset-4 hover:underline'
        >
          登录
        </Link>
      </p>
    </div>
  );
}
