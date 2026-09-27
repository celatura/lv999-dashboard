'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertModal } from '@/components/modal/alert-modal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Icons } from '@/components/icons';
import {
  deleteKnowledgeDocumentMutation,
  retryKnowledgeDocumentMutation
} from '../../api/mutations';
import type { KnowledgeDocument } from '../../api/types';

/** 预览弹窗按需加载：不打开预览则不下载该 chunk（bundle-dynamic-imports，与资产预览同策略） */
const KnowledgePreviewDialog = dynamic(
  () => import('../knowledge-preview-dialog').then((m) => m.KnowledgePreviewDialog),
  { ssr: false }
);

interface CellActionProps {
  data: KnowledgeDocument;
}

/**
 * 行操作：预览（全文/片段）+ 重新摄取（重试）+ 删除。
 * 重试对任意状态可用（含卡在 processing 的文档），服务端整体替换片段，幂等。
 */
export function CellAction({ data }: CellActionProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewMounted, setPreviewMounted] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const deleteMutation = useMutation(deleteKnowledgeDocumentMutation);
  const retryMutation = useMutation(retryKnowledgeDocumentMutation);

  const handleRetry = () => {
    retryMutation.mutate(data.id, {
      onSuccess: ({ status, chunkCount }) => {
        if (status === 'ready') {
          toast.success(`已重新摄取，共 ${chunkCount} 个片段`);
        } else {
          toast.error('重新摄取失败，请稍后再试');
        }
      },
      onError: () => toast.error('重新摄取失败，请稍后再试')
    });
  };

  return (
    <>
      {previewMounted && (
        <KnowledgePreviewDialog
          documentId={data.id}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
      <AlertModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          deleteMutation.mutate(data.id, {
            onSuccess: () => {
              toast.success('文档已删除');
              setDeleteOpen(false);
            },
            onError: () => toast.error('删除失败，请稍后重试')
          })
        }
        loading={deleteMutation.isPending}
        title='删除这篇知识库文档？'
        description='其切分片段会一并删除，之后 Agent 不再检索到该内容，此操作不可撤销。'
        confirmLabel='删除'
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger render={<Button variant='ghost' className='h-8 w-8 p-0' />}>
          <span className='sr-only'>打开菜单</span>
          <Icons.ellipsis className='h-4 w-4' />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuGroup>
            <DropdownMenuLabel>操作</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                setPreviewMounted(true);
                setPreviewOpen(true);
              }}
            >
              <Icons.eye className='mr-2 h-4 w-4' /> 预览
            </DropdownMenuItem>
            <DropdownMenuItem disabled={retryMutation.isPending} onClick={handleRetry}>
              {retryMutation.isPending ? (
                <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <Icons.redo className='mr-2 h-4 w-4' />
              )}
              重新摄取
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
              <Icons.trash className='mr-2 h-4 w-4' /> 删除
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
