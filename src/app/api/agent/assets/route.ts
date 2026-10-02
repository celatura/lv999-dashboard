import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { createDesignAsset, listAssets } from '@/features/agent/api/service';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { MAX_REQUEST_BYTES } from '@/features/agent/constants/limits';
import { createDesignRequestSchema } from '@/features/design/api/types';
import { decodePreviewPng } from '@/features/design/lib/preview-png';
import type { AssetFilters } from '@/features/agent/api/types';

export const runtime = 'nodejs';

/** design 写入限流：30 次/分/用户（保存为低频用户操作，留足余量） */
const DESIGN_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 仅接受 'true'/'false'；其他值视为未筛选 */
function parseBoolean(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const { searchParams } = new URL(request.url);
  const filters: AssetFilters = {
    page: parseInteger(searchParams.get('page')),
    limit: parseInteger(searchParams.get('limit')),
    search: searchParams.get('search') ?? undefined,
    kind: searchParams.get('kind') ?? undefined,
    favorite: parseBoolean(searchParams.get('favorite')),
    sort: searchParams.get('sort') ?? undefined
  };

  const result = await listAssets(userId, filters);
  return Response.json(result);
}

/** 创建 design 资产：文档 JSON 落 content 列，导出 PNG 预览落 OSS */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  // 限流与读 body 并行；按「限流 → 体积 → 解析 → 校验」顺序处理
  const [allowed, rawBody] = await Promise.all([
    checkRateLimit('design', userId, DESIGN_RATE_LIMIT, RATE_LIMIT_WINDOW_SECONDS),
    request.text()
  ]);
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_REQUEST_BYTES) {
    return apiError(413, 'payload_too_large', 'Request body too large');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON body');
  }

  const parsed = createDesignRequestSchema.safeParse(rawJson);
  if (!parsed.success) {
    return apiError(400, 'invalid_request', 'Invalid design document');
  }
  const { title, document, previewPng } = parsed.data;

  // 预览 PNG：base64 解码 + 魔数/体积校验（畸形或超限按无效请求处理）
  let previewBuffer: Buffer | null = null;
  if (previewPng) {
    try {
      previewBuffer = decodePreviewPng(previewPng);
    } catch {
      return apiError(400, 'invalid_request', 'Invalid preview image');
    }
  }

  const asset = await createDesignAsset({
    userId,
    title: title?.trim() || '未命名设计',
    document: JSON.stringify(document),
    previewPng: previewBuffer
  });
  return Response.json({ id: asset.id });
}
