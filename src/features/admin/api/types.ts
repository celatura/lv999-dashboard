import { z } from 'zod';

/**
 * 管理员用户管理类型契约（前后端共用）。
 *
 * 服务端数据访问在 `api/service.ts`（server-only，查 Better Auth user 表 + 复用 credits service + 级联清理）；
 * 客户端经 `api/queries.ts` / `api/mutations.ts` 走 `/api/admin/*` Route Handlers（均 isAdmin 403 守卫）。
 */

/** 管理端用户列表项：Better Auth user 基本信息 + 合并的项目 Credits 余额 */
export interface AdminUser {
  id: string;
  /** 展示名：Better Auth user.name，缺省回退邮箱前缀或 userId */
  name: string;
  /** 主邮箱（无邮箱时为占位串） */
  email: string;
  imageUrl: string;
  /** 注册时间（ISO 字符串） */
  createdAt: string;
  /** 最近登录时间（ISO 字符串）；从未登录为 null */
  lastSignInAt: string | null;
  /** Credits 余额（无账户行视为 0） */
  balance: number;
}

export interface AdminUserFilters {
  page?: number;
  limit?: number;
  /** 按邮箱 / 名 / userId 模糊搜索（ilike 匹配 user 表） */
  query?: string;
  /** 排序（JSON 字符串 `[{ id, desc }]`）；支持 createdAt / lastSignInAt，其余忽略 */
  sort?: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 调 Credits 请求体：
 * - mode='grant'：在现有余额上「加」amount（amount 必须为正整数），复用 grantCredits；
 * - mode='set'：把余额「设定」为 amount（amount 非负整数），复用 setBalance。
 * 两者都会写 credit_ledger 流水；note 记入流水 meta。
 */
export const adjustCreditsSchema = z
  .object({
    mode: z.enum(['grant', 'set']),
    amount: z.number().int('数额必须是整数'),
    note: z.string().trim().max(200, '备注不超过 200 字').optional()
  })
  .refine((value) => (value.mode === 'grant' ? value.amount > 0 : value.amount >= 0), {
    message: '数额不合法：「加」需为正整数，「设定」需为非负整数',
    path: ['amount']
  });

export type AdjustCreditsRequest = z.infer<typeof adjustCreditsSchema>;

/** 调 Credits 应答：操作后的新余额 */
export interface AdjustCreditsResult {
  balance: number;
}

/** 级联删除结果：各表删除行数 + OSS 删除对象数（供前端 toast 展示清理明细） */
export interface DeleteUserResult {
  conversations: number;
  messages: number;
  assets: number;
  skills: number;
  knowledgeDocuments: number;
  knowledgeChunks: number;
  creditLedger: number;
  creditsAccounts: number;
  ossObjects: number;
}
