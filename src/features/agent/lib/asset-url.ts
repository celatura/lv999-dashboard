import type { Asset } from '../api/types';

/**
 * 资产图片 URL 构造（客户端共用：资产列表 / 选图弹窗）。**仅适用于 image / design**
 * （video 封面走各自的 `?snapshot=1` 分支；把 video 传进来会让 `<img>` 去拉整个视频字节）。
 *
 * 缩略图一律走 `/raw` 代理的 `?thumb=1`（服务端改用 OSS 原生图片处理等比缩放到 320w），
 * 避免为 36~150px 的格子拉 1~2MB 原图（一页 10~60 张就是十几到几十 MB 函数出口带宽）。
 *
 * 版本参数 `v=updatedAt` **只给 design 加**：design 的预览 PNG 保存时会覆盖同一 storageKey，
 * 而 `/raw` 响应有 `Cache-Control: private, max-age=3600`——不带版本号则保存后列表缩略图
 * 最长 1 小时仍是旧图。image 内容不可变，不需要版本；而收藏切换等操作会刷新 updatedAt，
 * 无差别加 v 会把整页不可变图全部打回源站。
 *
 * 画布渲染与导出**不要**用这里（需要原尺寸像素），走
 * `features/design/hooks/use-asset-image` 的 `assetRawUrl`。
 */
export function assetThumbUrl(asset: Pick<Asset, 'id' | 'kind' | 'updatedAt'>): string {
  const base = `/api/agent/assets/${asset.id}/raw?thumb=1`;
  return asset.kind === 'design' ? `${base}&v=${encodeURIComponent(asset.updatedAt)}` : base;
}

/** 图片资产缩略图 URL（image 内容不可变，无需 updatedAt 版本参数） */
export function imageThumbnailUrl(assetId: string): string {
  return `/api/agent/assets/${assetId}/raw?thumb=1`;
}
