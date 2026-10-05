import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { isUuid } from '@/lib/utils';
import { getAsset } from '@/features/agent/api/service';
import { getServerFetchUrl, imageThumbUrl, videoSnapshotUrl } from '@/lib/oss';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * 资产字节同源代理（关键：规避 canvas 跨域污染）。
 *
 * 设计画布内引用的图片一律经此端点加载：服务端用短期签名 URL 拉取 OSS 对象后
 * 以「同源」流式回传字节。因响应与页面同源，canvas 不会被 taint，
 * stage.toDataURL 导出正常，无需为 OSS 桶配置 CORS。
 *
 * 图片资产内容不可变（编辑产出新资产、新 id），故可安全地做浏览器私有缓存。
 * 注：design 预览 PNG 是**覆盖同一 storageKey** 的（保存会重写），缩略图调用方需带
 * `&v=updatedAt` 版本参数破缓存（见 features/agent/lib/asset-url.ts）。
 *
 * 缩略图：带 `?thumb=1` 时对 image/design 改用 OSS 原生图片处理（`image/resize,w_320`，
 * 只等比缩放不裁切）后同样同源回传，避免列表/选图网格为 36~150px 的格子拉 1~2MB 原图；
 * 画布渲染与导出不带此参数（需要原尺寸像素）。
 *
 * 视频封面：带 ?snapshot=1 时，对 video 资产改用 OSS 原生视频截帧（videoSnapshotUrl）签发
 * 封面帧 URL 后同样以同源流式回传（列表/卡片/预览 poster 共用，避免客户端签名与 CORS）。
 */
export async function GET(request: Request, context: RouteContext) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }
  const { id } = await context.params;
  if (!isUuid(id)) {
    return apiError(404, 'not_found', 'Asset not found');
  }
  const asset = await getAsset(userId, id);
  // 仅带 storageKey 的二进制资产可代理（图片 / design 预览 PNG / 视频）
  if (!asset || !asset.storageKey) {
    return apiError(404, 'not_found', 'Asset not found');
  }

  // 视频封面（?snapshot=1）走 OSS 视频截帧；缩略图（?thumb=1）走 OSS 图片处理等比缩放；
  // 其余走完整对象的短期签名 URL（300s 足够一次拉取）
  const params = new URL(request.url).searchParams;
  const wantSnapshot = params.get('snapshot') === '1';
  const wantThumb =
    params.get('thumb') === '1' && (asset.kind === 'image' || asset.kind === 'design');
  // 服务端拉取全程走 server client（OSS_INTERNAL=true 时经内网，免公网流出流量费）——
  // 这些 URL 只被下方 fetch 消费、不下发浏览器，故可用内网地址
  const signedUrl =
    wantSnapshot && asset.kind === 'video'
      ? videoSnapshotUrl(asset.storageKey, { width: 400, expiresInSeconds: 300, internal: true })
      : wantThumb
        ? imageThumbUrl(asset.storageKey, { internal: true })
        : await getServerFetchUrl(asset.storageKey, 300);
  let upstream = await fetch(signedUrl);
  // 图片处理不可用（bucket 未开通等）时回退原图：缩略图只是体积优化，不该让图裂掉。
  // 404 不重试：那是对象本身缺失（历史遗留/已清理），再拉一次只会多一次无谓请求并误导日志。
  if (!upstream.ok && wantThumb && upstream.status !== 404) {
    console.warn('[agent] oss image resize failed, fallback to original object', {
      status: upstream.status
    });
    upstream = await fetch(await getServerFetchUrl(asset.storageKey, 300));
  }
  if (!upstream.ok || !upstream.body) {
    // 行还在但 OSS 对象缺失（历史遗留/被清理），或视频截帧不支持：明确 404，交由客户端占位处理
    return apiError(404, 'not_found', 'Asset object not found');
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
