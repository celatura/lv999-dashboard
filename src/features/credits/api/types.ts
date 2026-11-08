/**
 * Credits 系统类型契约（server + client 共享）。
 *
 * service.ts 是唯一改后端时替换的文件；queries.ts 与组件只依赖本文件的类型。
 */

/** 流水类型：grant=发放，其余为各计费入口的消耗 */
export type CreditKind = 'grant' | 'chat' | 'image' | 'video' | 'knowledge';

export const CREDIT_KIND_VALUES: readonly CreditKind[] = [
  'grant',
  'chat',
  'image',
  'video',
  'knowledge'
] as const;

/** 流水计量明细（meta，jsonb）：各类型记录不同的计量字段 */
export type CreditLedgerMeta =
  | {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      conversationId?: string;
      aborted?: boolean;
    }
  | { assetId?: string; edit?: boolean }
  | { assetId?: string; resolution?: string; duration?: number }
  | { documentId?: string; tokens?: number }
  | { note?: string }
  | Record<string, unknown>;

/** 单条流水（前端展示） */
export interface LedgerEntry {
  id: string;
  userId: string;
  /** 正=grant，负=消耗 */
  delta: number;
  /** 本笔后余额快照 */
  balanceAfter: number;
  kind: CreditKind;
  meta: CreditLedgerMeta | null;
  createdAt: string;
}

/** 流水分页响应 */
export interface LedgerResponse {
  entries: LedgerEntry[];
  total: number;
  page: number;
  limit: number;
}

/** 流水筛选（nuqs URL 状态） */
export interface LedgerFilters {
  page?: number;
  limit?: number;
  /** 逗号分隔的 kind 筛选（grant,chat,image,video,knowledge） */
  kind?: string;
  sort?: string;
}

/** 当前余额（GET /api/agent/credits） */
export interface BalanceResponse {
  /** 可用额度 */
  balance: number;
  reserved: number;
  total: number;
}
