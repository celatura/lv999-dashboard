import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { listLedger } from '@/features/credits/api/service';
import { CREDIT_KIND_VALUES, type LedgerFilters } from '@/features/credits/api/types';

export const runtime = 'nodejs';

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 枚举筛选值（逗号分隔）：非法值直接丢弃，不返回 400，保持列表可用 */
function parseEnumList(value: string | null, allowed: readonly string[]): string | undefined {
  if (!value) return undefined;
  const allowedSet = new Set(allowed); // 单次建集，后续逐项 O(1) 查找
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => allowedSet.has(item));
  return items.length > 0 ? items.join(',') : undefined;
}

/**
 * GET Credits 流水分页（供 /dashboard/profile/credits 表格；nuqs 分页/筛选）。
 * 按 userId 过滤（归属即权限），kind 可选筛选，createdAt 倒序。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const { searchParams } = new URL(request.url);
  const filters: LedgerFilters = {
    page: parseInteger(searchParams.get('page')),
    limit: parseInteger(searchParams.get('limit')),
    kind: parseEnumList(searchParams.get('kind'), CREDIT_KIND_VALUES),
    sort: searchParams.get('sort') ?? undefined
  };

  const result = await listLedger(userId, filters);
  return Response.json(result);
}
