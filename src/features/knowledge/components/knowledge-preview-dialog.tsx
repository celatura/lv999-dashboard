'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/features/agent/lib/format';
import { knowledgeDocumentDetailQueryOptions } from '../api/queries';
import type { KnowledgeStatus } from '../constants/knowledge';
import { getSourceMeta, getStatusMeta } from '../constants/display';

interface KnowledgePreviewDialogProps {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 非 ready 状态提示：processing 可能无内容/片段未就绪；failed 引导重试（不做失败诊断） */
function StatusHint({ status }: { status: KnowledgeStatus }) {
  if (status === 'ready') return null;
  return (
    <div className='bg-muted/50 text-muted-foreground mb-3 rounded-md border px-3 py-2 text-xs'>
      {status === 'processing'
        ? '文档正在摄取中：正文可能尚未处理完成、片段可能尚未就绪，可稍后重新打开查看。'
        : '该文档摄取失败（多为临时故障）：可关闭后在列表行操作中「重新摄取」。'}
    </div>
  );
}

/**
 * 知识库文档预览弹窗（只读快照）：
 * 头部元信息 +「全文 / 片段」Tab；片段列表不返回 embedding（服务端即不查该列）。
 * 每次打开都重拉（staleTime=0），摄取完成后片段数/状态即为最新。
 */
export function KnowledgePreviewDialog({
  documentId,
  open,
  onOpenChange
}: KnowledgePreviewDialogProps) {
  const { data, isError, error } = useQuery({
    ...knowledgeDocumentDetailQueryOptions(documentId),
    enabled: open
  });
  // 文档可能已被删除（或非本人）：区分 404，给出明确文案
  const notFound = error instanceof ApiError && error.status === 404;
  const document = data?.document;
  const statusMeta = document ? getStatusMeta(document.status) : null;
  const sourceMeta = document ? getSourceMeta(document.source) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl'>
        <DialogHeader className='flex shrink-0 flex-row items-center justify-between gap-3 border-b px-4 py-3 pr-12'>
          <div className='min-w-0'>
            <DialogTitle className='truncate'>{document?.title ?? '文档预览'}</DialogTitle>
            {document?.sourceAssetTitle && (
              <p className='text-muted-foreground truncate text-xs'>
                来自《{document.sourceAssetTitle}》
              </p>
            )}
            <DialogDescription className='sr-only'>知识库文档内容预览</DialogDescription>
          </div>
          {document && statusMeta && sourceMeta && (
            <div className='flex shrink-0 items-center gap-2'>
              <Badge variant={statusMeta.variant}>
                <statusMeta.icon
                  className={document.status === 'processing' ? 'animate-spin' : undefined}
                />
                {statusMeta.label}
              </Badge>
              <Badge variant='outline'>
                <sourceMeta.icon className='size-3' />
                {sourceMeta.label}
              </Badge>
              <span className='text-muted-foreground text-xs'>{document.chunkCount} 个片段</span>
              <span className='text-muted-foreground text-xs'>
                {formatDateTime(document.updatedAt)}
              </span>
            </div>
          )}
        </DialogHeader>
        {/* 错误分支独占渲染：删除后重开弹窗时缓存数据与 isError 会同时存在（同资产预览弹窗的教训） */}
        {isError ? (
          <div className='text-destructive p-6 text-sm'>
            {notFound ? '该文档已被删除或不存在。' : '加载文档失败，请稍后重试。'}
          </div>
        ) : data ? (
          <Tabs defaultValue='content' className='min-h-0 flex-1 gap-0'>
            <div className='shrink-0 px-4 pt-3'>
              <TabsList>
                <TabsTrigger value='content'>全文</TabsTrigger>
                <TabsTrigger value='chunks'>片段</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value='content' className='min-h-0 flex-1 overflow-auto'>
              <div className='p-4'>
                <StatusHint status={data.document.status} />
                <div className='text-sm whitespace-pre-wrap'>
                  {data.document.content || '（无内容）'}
                </div>
              </div>
            </TabsContent>
            <TabsContent value='chunks' className='min-h-0 flex-1 overflow-auto'>
              {data.chunks.length === 0 ? (
                <div className='text-muted-foreground p-4 text-sm'>
                  {data.document.status === 'processing'
                    ? '片段生成中，请稍后重新打开查看。'
                    : data.document.status === 'failed'
                      ? '该文档摄取失败，无片段。'
                      : '暂无片段。'}
                </div>
              ) : (
                <ul className='flex flex-col gap-3 p-4'>
                  {data.chunks.map((chunk) => (
                    <li key={chunk.chunkIndex} className='rounded-lg border p-3'>
                      <div className='text-muted-foreground mb-1.5 flex items-center gap-3 text-xs'>
                        <span className='font-medium'>#{chunk.chunkIndex}</span>
                        <span>{chunk.content.length} 字</span>
                      </div>
                      <p className='text-sm whitespace-pre-wrap'>{chunk.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className='text-muted-foreground p-6 text-sm'>加载中…</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
