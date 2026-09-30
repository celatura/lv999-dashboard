/**
 * 生成类错误（图片/视频）：携带 billable 标志供 Credits 计费判定。
 *
 * billable 判据（见 docs/credits.md §7，已对照百炼官方计费口径核实）：
 * - **false（不扣）**：上游明确返回失败 —— 鉴权 / 参数 / 限流 / 网络（提交前）/ 内容审核拒绝。
 *   百炼「失败不计费、仅对成功生成计费」，上游未计费故不扣（审核拒绝照扣等于作者赚差价）。
 * - **true（照扣）**：成功、客户端侧中断（abort / 轮询超时，上游状态未知可能已 SUCCEEDED）、
 *   已生成后下载失败。上游可能/已经计费，保守照扣。
 *
 * 生成函数封装「提交 → 轮询 → 下载」，不回吐 task_id，故只能按错误分类判定 billable。
 */
export class GenerationError extends Error {
  /** 是否应扣费（true=上游可能/已计费，照扣；false=上游明确失败，不扣） */
  readonly billable: boolean;

  constructor(message: string, options?: { cause?: unknown; billable?: boolean }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'GenerationError';
    this.billable = options?.billable ?? false;
  }
}

/**
 * 判定任意错误是否应扣费。
 * 非 GenerationError（如 OSS/DB 转存失败、配置错误）默认 false —— 保守不扣，
 * 避免把本地基础设施故障误判为上游计费。
 */
export function isBillableError(error: unknown): boolean {
  return error instanceof GenerationError && error.billable;
}

/**
 * 汇集错误链上的 name/message/responseBody/code，供关键词匹配（详情仍走日志）。
 * AI SDK 的上游错误（APICallError 等）把 HTTP 状态与响应体放在子类字段上，
 * 逐层沿 cause 上溯才能拿到完整信号（视频模块的错误映射与模型可用性识别共用）。
 */
export function errorHaystack(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
      const withBody = current as {
        responseBody?: unknown;
        code?: unknown;
        cause?: unknown;
      };
      if (typeof withBody.responseBody === 'string') {
        parts.push(withBody.responseBody);
      } else if (withBody.responseBody != null) {
        try {
          parts.push(JSON.stringify(withBody.responseBody));
        } catch {
          // 忽略无法序列化的 responseBody
        }
      }
      if (withBody.code != null) parts.push(String(withBody.code));
      current = withBody.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' ');
}
