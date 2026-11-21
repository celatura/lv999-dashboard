'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertModal } from '@/components/modal/alert-modal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { formatDate } from '@/lib/format';
import { deleteSkillMutation } from '../../api/mutations';
import { skillDetailsQueryOptions } from '../../api/queries';
import type { SkillListItem } from '../../api/types';

/** 编辑对话框按需加载：未打开就不下载该 chunk（bundle-dynamic-imports） */
const SkillEditDialog = dynamic(
  () => import('./skill-edit-dialog').then((module) => module.SkillEditDialog),
  { ssr: false }
);

/**
 * 技能管理列表：所有行都是用户自建技能（可编辑 / 删除）。
 * 数据源为完整内容列表（skillDetailsQueryOptions，服务端已预取）；写操作按域失效自动刷新。
 */
export function SkillsTable() {
  const { data } = useSuspenseQuery(skillDetailsQueryOptions());
  const [editTarget, setEditTarget] = useState<SkillListItem | null>(null);
  const [dialogMounted, setDialogMounted] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillListItem | null>(null);
  const deleteMutation = useMutation(deleteSkillMutation);

  const openEdit = (skill: SkillListItem) => {
    setDialogMounted(true);
    setEditTarget(skill);
  };

  return (
    <>
      {dialogMounted && (
        <SkillEditDialog
          open={editTarget !== null}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          editSkill={editTarget}
        />
      )}
      <AlertModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteMutation.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('技能已删除');
              setDeleteTarget(null);
            },
            onError: () => toast.error('删除失败，请稍后重试')
          });
        }}
        loading={deleteMutation.isPending}
        title={`删除技能「${deleteTarget?.name ?? ''}」？`}
        description='删除后，后续消息将无法再选择该技能；已发送的消息不受影响。此操作不可撤销。'
        confirmLabel='删除'
      />

      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>工具</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead className='w-12 text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.skills.map((skill) => (
              <TableRow key={skill.id}>
                <TableCell className='font-medium whitespace-normal'>{skill.name}</TableCell>
                <TableCell className='text-muted-foreground whitespace-normal'>
                  {skill.description}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {skill.tools === null ? '不限' : `${skill.tools.length} 个`}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {skill.updatedAt ? formatDate(skill.updatedAt) : '—'}
                </TableCell>
                <TableCell className='text-right'>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger
                      render={<Button variant='ghost' className='h-8 w-8 p-0' />}
                    >
                      <span className='sr-only'>打开菜单</span>
                      <Icons.ellipsis className='h-4 w-4' />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onClick={() => openEdit(skill)}>
                        <Icons.edit className='mr-2 h-4 w-4' /> 编辑
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setDeleteTarget(skill)}>
                        <Icons.trash className='mr-2 h-4 w-4' /> 删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {data.skills.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground h-24 text-center text-sm'>
                  还没有技能。点右上角「从模板新建」快速开始，或「新建技能」从空白写起。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** Suspense 回退：客户端导航且缓存为空时展示（服务端已预取时不会出现） */
export function SkillsTableSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-80 w-full' />
    </div>
  );
}
