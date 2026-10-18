'use client';

import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { FieldGroup } from '@/components/ui/field';
import { Icons } from '@/components/icons';
import { ApiError } from '@/lib/api-client';
import { useAppForm } from '@/lib/form';
import { adjustCreditsMutation } from '../api/mutations';
import type { AdminUser } from '../api/types';

/**
 * 表单本地校验（amount 以字符串收集，提交时转 number）：
 * 用字符串字段规避「number 输入清空 → undefined」与 z.number() 的类型摩擦；
 * 服务端另有 adjustCreditsSchema（amount:number）对 JSON body 独立校验，双端防御。
 */
const adjustFormSchema = z
  .object({
    mode: z.enum(['grant', 'set']),
    amount: z.string().trim().min(1, '请输入数额'),
    note: z.string().trim().max(200, '备注不超过 200 字').optional()
  })
  .refine((value) => /^\d+$/.test(value.amount), {
    error: '数额必须是非负整数',
    path: ['amount']
  })
  .refine((value) => (value.mode === 'grant' ? Number(value.amount) > 0 : true), {
    error: '「增加」数额需为正整数',
    path: ['amount']
  });

type AdjustFormValues = z.infer<typeof adjustFormSchema>;

const MODE_OPTIONS = [
  { value: 'grant', label: '增加（在现有余额上加）' },
  { value: 'set', label: '设定（直接设为该余额）' }
];

function resolveAdjustError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '无权限执行此操作';
    if (error.status === 429) return '操作过于频繁，请稍后再试';
    if (error.status === 400) return '请求无效，请检查数额后重试';
  }
  return '调整 Credits 失败，请稍后重试';
}

interface AdjustCreditsDialogProps {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 调整某用户 Credits：加 / 设 + 数额 + 备注 → POST /api/admin/users/[id]/credits（复用 grantCredits/setBalance） */
export function AdjustCreditsDialog({ user, open, onOpenChange }: AdjustCreditsDialogProps) {
  const mutation = useMutation(adjustCreditsMutation);

  const form = useAppForm({
    defaultValues: { mode: 'grant', amount: '', note: '' } as AdjustFormValues,
    validators: { onSubmit: adjustFormSchema },
    onSubmit: async ({ value }) => {
      const amount = Number(value.amount);
      const note = value.note?.trim();
      try {
        const result = await mutation.mutateAsync({
          id: user.id,
          values: { mode: value.mode, amount, ...(note ? { note } : {}) }
        });
        toast.success(
          value.mode === 'grant'
            ? `已为 ${user.name} 增加 ${amount} Credits，当前余额 ${result.balance}`
            : `已将 ${user.name} 余额设为 ${result.balance}`
        );
        onOpenChange(false);
      } catch (error) {
        toast.error(resolveAdjustError(error));
      }
    }
  });

  // 每次打开回到初始状态（关闭即丢弃草稿）
  useEffect(() => {
    if (open) form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form 实例为稳定引用，仅在 open 变化时重置
  }, [open]);

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
          <DialogTitle>调整 Credits</DialogTitle>
          <DialogDescription className='truncate'>
            {user.name}（{user.email}）· 当前余额 {user.balance}
          </DialogDescription>
        </DialogHeader>

        {/* AppForm 不接受 id/className，故用原生 form + handleSubmit；footer 提交按钮经 form 属性关联 */}
        <form
          id='adjust-credits-form'
          className='flex flex-col gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField
              name='mode'
              children={(field) => (
                <field.SelectField label='操作方式' required options={MODE_OPTIONS} />
              )}
            />
            <form.AppField
              name='amount'
              children={(field) => (
                <field.TextField
                  label='数额'
                  required
                  type='text'
                  inputMode='numeric'
                  placeholder='如 500'
                  disabled={mutation.isPending}
                />
              )}
            />
            <form.AppField
              name='note'
              children={(field) => (
                <field.TextField
                  label='备注（可选）'
                  placeholder='记入流水，如「活动赠送」'
                  maxLength={200}
                  disabled={mutation.isPending}
                />
              )}
            />
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            取消
          </Button>
          <Button type='submit' form='adjust-credits-form' disabled={mutation.isPending}>
            {mutation.isPending ? <Icons.spinner className='animate-spin' /> : <Icons.billing />}
            确认调整
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
