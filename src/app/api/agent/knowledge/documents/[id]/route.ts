import { auth } from '@clerk/nextjs/server';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { deleteDocument, getDocumentDetail, listChunks } from '@/features/knowledge/api/service';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 文档详情（预览用）：元信息 + 入库原文 + 片段列表（不 select embedding 列）。
 * 只读端点：无计费、无写入限流；越权与不存在同样 404（归属即权限）。
 */
export async function GET(_request: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Document not found');
  }

  const document = await getDocumentDetail(userId, id);
  if (!document) {
    return apiError(404, 'not_found', 'Document not found');
  }
  const chunks = await listChunks(userId, id);
  return Response.json({ document, chunks });
}

/** 删除文档：片段由外键 ON DELETE CASCADE 级联清理（删除后不再被检索到） */
export async function DELETE(_request: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Document not found');
  }

  const deleted = await deleteDocument(userId, id);
  if (!deleted) {
    return apiError(404, 'not_found', 'Document not found');
  }
  return Response.json({ success: true });
}
