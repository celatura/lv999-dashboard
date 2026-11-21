/**
 * 设计版式键（客户端安全）。
 *
 * 从 lib/layouts.ts 拆出：Agent 工具契约（tool-contracts.ts）需要在客户端类型图中
 * 引用同一枚举，但不能把服务端版式计算模块（含设计文档类型）带进客户端 bundle。
 */
export const LAYOUT_KEYS = ['top-image', 'full-image-bar', 'left-image'] as const;

export type LayoutKey = (typeof LAYOUT_KEYS)[number];
