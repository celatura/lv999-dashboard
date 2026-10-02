/**
 * 认证流程的回跳目标解析（server / client 通用，纯函数无副作用）。
 *
 * 仅接受**站内相对路径**（以单个 `/` 开头，排除 `//` 协议相对 URL），
 * 防止开放重定向（open redirect）；非法或缺省时回退到总览页。
 */
export const DEFAULT_REDIRECT_TARGET = '/dashboard/overview';

export function sanitizeRedirectTarget(value: string | null | undefined): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT_TARGET;
  // 必须以单个 '/' 开头，且第二字符不为 '/' 或 '\'（后者经 WHATWG URL 解析会被当作
  // authority → 变成对外站的开放重定向）。
  if (!/^\/(?!\/)/.test(value) || value.startsWith('/\\')) return DEFAULT_REDIRECT_TARGET;
  // 排除控制字符与空白（防响应头注入与解析歧义）。
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x20) return DEFAULT_REDIRECT_TARGET;
  }
  return value;
}
