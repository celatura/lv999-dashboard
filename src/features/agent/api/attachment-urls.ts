import type { UIMessage } from 'ai';
import { getSignedUrl } from '@/lib/oss';
import { isUuid } from '@/lib/utils';
import { getAsset } from './service';

/** 同源资产代理路径（客户端 file part 的稳定 url）；只接受本模式，绝不信任任意外部 URL */
const RAW_URL_PATTERN = /^\/api\/agent\/assets\/([^/]+)\/raw$/;

/** 签名 URL 有效期：覆盖单次模型调用全程（与 I2I / I2V 源图一致） */
const ATTACHMENT_URL_TTL_SECONDS = 900;

/**
 * 把消息中的图片附件 file part 重写为 OSS 签名 URL（供百炼多模态输入公网拉取）。
 * - 仅接受同源 /raw 代理路径：解析 assetId → 归属校验 → storageKey → 短期签名 URL；
 * - 不可解析（已删除 / 越权 / 非图片 / 外部 URL）的 file part 移除并告警（历史消息降级继续）；
 * - DB 始终存稳定 /raw 路径，历史附件每次请求重签，无过期问题；
 * - vision=false（模型不支持多模态）时移除全部 file part（客户端已按能力禁用附件，服务端兜底）。
 */
export async function prepareMessageAttachments(
  userId: string,
  messages: UIMessage[],
  vision: boolean
): Promise<UIMessage[]> {
  const signedUrls = new Map<string, string | null>();

  const resolveUrl = async (url: string): Promise<string | null> => {
    const match = RAW_URL_PATTERN.exec(url);
    const assetId = match?.[1];
    if (!assetId || !isUuid(assetId)) return null;
    const cached = signedUrls.get(assetId);
    if (cached !== undefined) return cached;
    const asset = await getAsset(userId, assetId);
    const signed =
      asset && asset.kind === 'image' && asset.storageKey
        ? await getSignedUrl(asset.storageKey, ATTACHMENT_URL_TTL_SECONDS)
        : null;
    signedUrls.set(assetId, signed);
    return signed;
  };

  const result: UIMessage[] = [];
  for (const message of messages) {
    let changed = false;
    const parts: UIMessage['parts'] = [];
    for (const part of message.parts) {
      if (part.type !== 'file') {
        parts.push(part);
        continue;
      }
      if (!vision || !part.mediaType.startsWith('image/')) {
        changed = true;
        continue;
      }
      const signed = await resolveUrl(part.url);
      if (!signed) {
        console.warn('[agent] attachment unresolvable, dropped from model input', {
          conversationUserId: userId,
          url: part.url
        });
        changed = true;
        continue;
      }
      parts.push({ ...part, url: signed });
      changed = true;
    }
    result.push(changed ? { ...message, parts } : message);
  }
  return result;
}
