/**
 * 新会话首页 → 会话页的「首条消息」一次性交接（client-only）。
 *
 * 背景：新会话在首次发送时才创建会话记录。创建后必须经「真实导航」
 * （router.replace）进入 /dashboard/agent/[id]，不能用 window.history.replaceState——
 * 后者会让 URL 与渲染树脱节，导致之后回到 /dashboard/agent 时组件被复用、
 * 状态不重置（历史 bug：点「新建会话」后仍显示旧会话内容）。
 *
 * 真实导航会重挂载 ChatWindow（初始消息为空），因此用本模块把待发送的首条消息
 * 交给目标页消费发送。幂等消费可安全应对 StrictMode 开发态的双执行。
 * 注意：消费时机在 chat-window 的挂载宏任务（setTimeout 0）内而非 effect 同步体——
 * StrictMode 模拟卸载的 useChat 清理（chat.stop()）会中止 effect 同步发出的发送，
 * 详见 chat-window.tsx 交接 effect 注释。
 */

interface PendingFirstMessage {
  conversationId: string;
  text: string;
  createdAt: number;
}

/** 交接时效：仅防护"导航被中断后陈旧消息被误发送"的极端场景 */
const FRESHNESS_MS = 30_000;

let pending: PendingFirstMessage | null = null;

/** 发送首条消息前写入；随后立即 router.replace 到会话页 */
export function setPendingFirstMessage(conversationId: string, text: string): void {
  pending = { conversationId, text, createdAt: Date.now() };
}

/**
 * 取出并清空（仅当会话 id 匹配且未过期）。
 * 幂等：重复调用（含 StrictMode 双执行）第二次返回 null。
 */
export function takePendingFirstMessage(conversationId: string): string | null {
  if (!pending || pending.conversationId !== conversationId) return null;
  if (Date.now() - pending.createdAt > FRESHNESS_MS) {
    pending = null;
    return null;
  }
  const { text } = pending;
  pending = null;
  return text;
}

/** 回到新会话首页时丢弃未消费的交接，避免陈旧消息在稍后访问该会话时被误发送 */
export function clearPendingFirstMessage(): void {
  pending = null;
}
