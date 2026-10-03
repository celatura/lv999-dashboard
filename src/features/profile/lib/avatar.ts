import 'server-only';
import { headers } from 'next/headers';
import sharp from 'sharp';
import { auth } from '@/lib/auth';

/**
 * 用户头像的服务端处理与写回（server-only）。
 *
 * 头像为纯存储操作，不接 Credits、不触发 AI 调用。规格化统一 256×256 png（cover 居中裁切），
 * 控体积、统一格式；写回经 Better Auth `updateUser` 触发 session cookie 重签，即时生效。
 */

/** 上传头像字节上限（5MB）：原图仅用于规格化，无需更大 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** 规格化边长（正方形，cover 居中裁切）；展示处按 CSS 缩放，单一源即可 */
export const AVATAR_EDGE = 256;

/**
 * `user.image` 存储的同源代理相对路径（`img src` 直接可用）。
 * 不存 OSS 签名 URL（会过期）、不设对象公开读（私有桶不变）——见 GET /api/avatar/[userId]。
 */
export function avatarImagePath(userId: string): string {
  return `/api/avatar/${userId}`;
}

/**
 * sharp 规格化：256×256 cover 居中裁切 → png。
 * 统一尺寸/格式并控体积（避免用户上传数 MB 原图占存储与带宽）。
 * 解码失败（魔数已过但字节损坏的边缘情况）由调用方捕获并回 400。
 */
export async function normalizeAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(AVATAR_EDGE, AVATAR_EDGE, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
}

/**
 * 经 Better Auth `updateUser` 写回 `user.image`，并返回**需转发给浏览器**的 Set-Cookie 头。
 *
 * 关键：`updateUser` 内部会 `setSessionCookie` 重签 session cookie（携带新 user 数据），
 * 但从 Route Handler 直接调用只会拿到返回体、拿不到 cookie——必须以 `asResponse: true`
 * 取出响应并转发其 Set-Cookie，浏览器才会立即用新值覆盖 cookieCache（否则 ≤60s 旧值）。
 *
 * 设置（image=路径）与重置（image=null）共用此路径：`updateUser` 原生支持 `image: null`
 * （透传 internalAdapter.updateUser 置空），故删除同样即时、各处一致回退首字母，无需绕 Drizzle。
 *
 * @throws updateUser 返回非 2xx（如会话在请求中途失效）时抛错，由调用方映射为 500。
 */
export async function commitUserImage(image: string | null): Promise<Headers> {
  const response = await auth.api.updateUser({
    body: { image },
    headers: await headers(),
    asResponse: true
  });
  if (!response.ok) {
    throw new Error(`updateUser failed with status ${response.status}`);
  }
  const forwarded = new Headers();
  for (const cookie of response.headers.getSetCookie()) {
    forwarded.append('set-cookie', cookie);
  }
  return forwarded;
}
