/**
 * 复制文本到系统剪贴板（纯工具，不含任何提示逻辑）。
 *
 * 主路径 `navigator.clipboard.writeText`：仅安全上下文可用，本项目部署走 https，正常命中。
 * 兜底 `execCommand('copy')`：防御权限被拒、页面未聚焦、非安全上下文（本地 http 直连 IP）
 * 与老浏览器等边缘情况——该 API 已废弃，但作为最后手段仍普遍可用，故保留。
 *
 * 返回是否成功，由调用方决定提示（不静默失败）。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒 / 文档未聚焦等：继续走 execCommand 兜底
    }
  }

  if (typeof document === 'undefined') return false;

  // 隐藏 textarea：fixed + 视口外 + 透明，避免插入时触发滚动或可见闪烁
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}
