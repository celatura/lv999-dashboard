import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { getAsset } from '@/features/agent/api/service';
import { getSignedUrl } from '@/lib/oss';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

function buildFileName(title: string, kind: string): string {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'asset';
  // design 有 storageKey（导出 PNG 预览），走 302 签名 URL 分支，下载得到 PNG；video 下载得到 mp4
  const extension =
    kind === 'html'
      ? 'html'
      : kind === 'image' || kind === 'design'
        ? 'png'
        : kind === 'video'
          ? 'mp4'
          : 'md';
  return `${safeTitle}.${extension}`;
}

export async function GET(_request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  const asset = await getAsset(userId, id);
  if (!asset) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  // 二进制资产（storageKey 存在，如图片）→ 带 response 覆盖的签名 URL（TTL 300s，附件下载名），302 直连 OSS。
  // 注意：判据必须是 storageKey 而不是 content —— 图片资产的 content 列存的是生成 prompt（不为 null），
  // 曾因此把 prompt 文本当作图片内容返回（历史缺陷：下载得到 ~1KB 的“PNG”）。
  if (asset.storageKey) {
    const fileName = buildFileName(asset.title, asset.kind);
    const url = await getSignedUrl(asset.storageKey, 300, {
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    });
    return Response.redirect(url, 302);
  }

  // design 无预览（AI 整版产出后尚未在画布保存）：content 是文档 JSON，不能当 PNG 下发；
  // 前端已隐藏该入口，此处为防御（避免下载到内容是 JSON 的 .png）
  if (asset.kind === 'design') {
    return apiError(501, 'not_implemented', 'Design preview has not been generated yet');
  }

  // 无 storageKey 且无内容：不可下载（理论不可达的兜底）
  if (asset.content === null) {
    return apiError(501, 'not_implemented', 'Asset content is not downloadable');
  }

  // 文本资产（内容存 content 列）：直接返回
  const fileName = buildFileName(asset.title, asset.kind);
  return new Response(asset.content, {
    headers: {
      'Content-Type': asset.mime ?? 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store'
    }
  });
}
