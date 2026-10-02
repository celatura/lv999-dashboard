'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { LoadingButton } from '@/components/ui/loading-button';
import { changePassword, signOut, updateUser } from '@/lib/auth-client';
import { useAppForm } from '@/lib/form';

const nameSchema = z.object({
  name: z.string().trim().min(1, '请输入名字').max(50, '名字过长')
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z.string().min(12, '新密码至少 12 位').max(256, '密码过长'),
    confirmPassword: z.string().min(1, '请再次输入新密码')
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: '两次输入的新密码不一致',
    path: ['confirmPassword']
  });

interface ProfileSettingsProps {
  name: string;
  email: string;
}

/**
 * 自建简版个人资料（替代 Clerk `<UserProfile/>`）：改名字（updateUser）+ 改密码（changePassword）+ 登出。
 * 登录邮箱只读展示——Better Auth 改邮箱需向新旧邮箱二次验证，MVP 延后。
 */
export function ProfileSettings({ name, email }: ProfileSettingsProps) {
  const router = useRouter();

  const nameForm = useAppForm({
    defaultValues: { name },
    validators: { onSubmit: nameSchema },
    onSubmit: async ({ value }) => {
      const { error } = await updateUser({ name: value.name.trim() });
      if (error) {
        toast.error(error.message || '更新名字失败');
        return;
      }
      toast.success('名字已更新');
      // 刷新服务端会话缓存，使侧边栏等处的名字同步更新
      router.refresh();
    }
  });

  const passwordForm = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validators: { onSubmit: passwordSchema },
    onSubmit: async ({ value }) => {
      const { error } = await changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true
      });
      if (error) {
        // 会话不够「新鲜」时 Better Auth 要求重新登录，原样提示其消息
        toast.error(error.message || '修改密码失败');
        return;
      }
      toast.success('密码已修改，其他设备的登录已失效');
      passwordForm.reset();
    }
  });

  return (
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>账号信息</CardTitle>
          <CardDescription>登录邮箱不可更改；名字可随时更新。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='text-muted-foreground mb-4 text-sm'>
            登录邮箱：<span className='text-foreground font-medium'>{email}</span>
          </div>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void nameForm.handleSubmit();
            }}
          >
            <FieldGroup>
              <nameForm.AppField
                name='name'
                children={(field) => (
                  <field.TextField label='名字' required placeholder='你的名字' />
                )}
              />
            </FieldGroup>
            <nameForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <LoadingButton type='submit' loading={isSubmitting}>
                  保存名字
                </LoadingButton>
              )}
            </nameForm.Subscribe>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
          <CardDescription>修改后其他设备的登录将被失效，需重新登录。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void passwordForm.handleSubmit();
            }}
          >
            <FieldGroup>
              <passwordForm.AppField
                name='currentPassword'
                children={(field) => (
                  <field.TextField
                    label='当前密码'
                    type='password'
                    required
                    autoComplete='current-password'
                  />
                )}
              />
              <passwordForm.AppField
                name='newPassword'
                children={(field) => (
                  <field.TextField
                    label='新密码'
                    type='password'
                    required
                    description='至少 12 位'
                    autoComplete='new-password'
                  />
                )}
              />
              <passwordForm.AppField
                name='confirmPassword'
                children={(field) => (
                  <field.TextField
                    label='确认新密码'
                    type='password'
                    required
                    autoComplete='new-password'
                  />
                )}
              />
            </FieldGroup>
            <passwordForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <LoadingButton type='submit' loading={isSubmitting}>
                  修改密码
                </LoadingButton>
              )}
            </passwordForm.Subscribe>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>退出登录</CardTitle>
          <CardDescription>退出当前账号并返回登录页。</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant='outline'
            onClick={async () => {
              await signOut();
              router.refresh();
              router.push('/auth/sign-in');
            }}
          >
            退出登录
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
