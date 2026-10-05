import { requireUserIdAuthoritative } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { avatarObjectKey, getOssServerClient, putObject } from '@/lib/oss';
import { ACCEPTED_IMAGE_MIMES, detectImageType } from '@/features/agent/lib/upload-image';
import {
  MAX_AVATAR_BYTES,
  avatarImagePath,
  commitUserImage,
  normalizeAvatar
} from '@/features/profile/lib/avatar';

export const runtime = 'nodejs';
/** 读表单 + sharp 规格化 + OSS 写入 + updateUser，均为轻量近同步操作，60s 足够 */
export const maxDuration = 60;

/** 头像写入限流：10 次/分/用户（纯存储操作、防刷；不计费） */
const AVATAR_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/**
 * POST：上传 / 更换头像（multipart：file 必填）。
 * 流程：限流 → formData → 校验（File 实例 / ≤5MB / mime 粗筛 / detectImageType 魔数）
 * → sharp 规格化 256×256 cover png → OSS 覆盖写（单 key）→ updateUser 写回 image（重签 cookie，即时生效）
 * → 返回 { image }（同源代理路径）并转发 Set-Cookie。
 *
 * userId 只取自会话（不接受参数，防越权改他人头像）；头像为纯存储，不接 Credits。
 */
export async function POST(request: Request) {
  const userId = await requireUserIdAuthoritative();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const allowed = await checkRateLimit(
    'avatar',
    userId,
    AVATAR_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'invalid_request', 'Expected multipart/form-data body');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return apiError(400, 'invalid_request', 'Missing file field');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return apiError(413, 'payload_too_large', 'Image too large');
  }
  // mime 前置粗筛（浏览器所报）；最终以魔数为准，防改扩展名绕过
  if (!(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(file.type)) {
    return apiError(
      400,
      'invalid_request',
      `Unsupported image type, accepted: ${ACCEPTED_IMAGE_MIMES.join(', ')}`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!detectImageType(buffer)) {
    return apiError(400, 'invalid_request', 'File is not a valid PNG/JPEG/WebP image');
  }

  // sharp 规格化：魔数已过但字节损坏（解码失败）→ 400，不写 OSS 不写库
  let normalized: Buffer;
  try {
    normalized = await normalizeAvatar(buffer);
  } catch (error) {
    console.warn('[avatar] sharp normalize failed:', error);
    return apiError(400, 'invalid_request', 'Failed to process image');
  }

  // OSS 覆盖写（单 key，无版本累积）；并发上传以最后者为准
  await putObject(avatarObjectKey(userId), normalized, 'image/png');

  // 写回 user.image 并转发重签的 session cookie（即时生效，绕过 ≤60s cookieCache）
  const image = avatarImagePath(userId);
  let cookieHeaders: Headers;
  try {
    cookieHeaders = await commitUserImage(image);
  } catch (error) {
    // OSS 对象已写入但 user.image 未更新：无害（下次上传覆盖同 key），据实回 500
    console.error('[avatar] updateUser failed:', error);
    return apiError(500, 'invalid_request', 'Failed to save avatar');
  }

  return Response.json({ image }, { headers: cookieHeaders });
}

/**
 * DELETE：删除 / 重置头像。
 * 流程：限流 → 删 OSS 对象（NoSuchKey 忽略；失败仅告警不阻塞）→ updateUser 置 image=null
 * （重签 cookie，各处即时回退首字母）→ 返回 { image: null } 并转发 Set-Cookie。
 *
 * 与设置对称走 updateUser（原生支持 null），避免 Drizzle 直改导致的 ≤60s cookieCache 旧值。
 */
export async function DELETE() {
  const userId = await requireUserIdAuthoritative();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const allowed = await checkRateLimit(
    'avatar',
    userId,
    AVATAR_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  // 删 OSS 对象；对象不存在（NoSuchKey）或网络异常均忽略——user.image 置空后即无访问路径
  try {
    await getOssServerClient().delete(avatarObjectKey(userId));
  } catch (error) {
    console.warn('[avatar] failed to delete OSS object:', error);
  }

  let cookieHeaders: Headers;
  try {
    cookieHeaders = await commitUserImage(null);
  } catch (error) {
    console.error('[avatar] updateUser(null) failed:', error);
    return apiError(500, 'invalid_request', 'Failed to remove avatar');
  }

  return Response.json({ image: null }, { headers: cookieHeaders });
}
