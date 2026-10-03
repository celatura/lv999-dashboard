import { verifySession } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { avatarObjectKey, getSignedUrl } from '@/lib/oss';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ userId: string }> };

/**
 * 头像同源代理（复用资产 /raw 的「签名拉 OSS → 同源回传字节 + Cache-Control」模式）。
 *
 * 登录即可访问任意 userId 的头像（头像半公开：管理页 / 对话需展示他人头像）。
 * 私有桶不变——服务端用短期签名 URL 拉取后同源回传，URL 不外泄、不过期。
 * 无头像（对象不存在，NoSuchKey → 上游 404）时明确回 404，前端 `AvatarImage` 自然回退首字母。
 *
 * 展示处一律读 `user.image`（= `/api/avatar/{userId}`），故写入后侧边栏 / 管理页 / 对话自动生效。
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await verifySession();
  if (!session) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const { userId } = await context.params;
  // 防路径穿越：userId 拼进 OSS key（avatars/{userId}.png），拒绝空值与含分隔符 / `..` 的输入，
  // 避免越权读取桶内其它前缀对象（Better Auth userId 为 URL 安全串，非 uuid，无需 uuid 校验）
  if (!userId || /[\\/]|\.\./.test(userId)) {
    return apiError(404, 'not_found', 'Avatar not found');
  }

  const signedUrl = await getSignedUrl(avatarObjectKey(userId), 300);
  const upstream = await fetch(signedUrl);
  if (!upstream.ok || !upstream.body) {
    return apiError(404, 'not_found', 'Avatar not found');
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'image/png',
      // 5 分钟浏览器私有缓存；换 / 删头像靠前端 `?v=` 破缓存或 max-age 到期刷新
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
