import { requireUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { checkRateLimit } from '@/features/agent/api/rate-limit';
import { createUploadedImageAsset } from '@/features/agent/api/service';
import {
  ACCEPTED_IMAGE_MIMES,
  MAX_UPLOAD_IMAGE_BYTES,
  detectImageType,
  imageTypeToExt,
  imageTypeToMime,
  readImageDimensions
} from '@/features/agent/lib/upload-image';

export const runtime = 'nodejs';
/** 读表单 + sharp 读尺寸 + OSS 转存，均为轻量同步/近同步操作，60s 足够 */
export const maxDuration = 60;

/** 上传限流：30 次/分/用户（上传不触发计费，仅存储成本，取与 design 写入同档） */
const UPLOAD_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

/** 取文件基名（去扩展名）作为资产标题 */
function fileBaseName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * 本地图片上传（multipart：file 必填）→ OSS + 建 image/source='upload' 资产。
 * 流程：限流 → formData → 校验（File 实例 / 大小 / mime / 魔数）→ sharp 读尺寸（降级可空）
 * → createUploadedImageAsset → 返回 { id, width?, height? }（尺寸供前端等比缩放插入画布）。
 * 上传不消耗 Credits（仅存储），故不做余额拦截。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return apiError(401, 'unauthorized', 'Unauthorized');
  }

  const allowed = await checkRateLimit(
    'upload',
    userId,
    UPLOAD_RATE_LIMIT,
    RATE_LIMIT_WINDOW_SECONDS
  );
  if (!allowed) {
    return apiError(429, 'too_many_requests', 'Too many requests', {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS)
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, 'invalid_request', 'Expected multipart/form-data body');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return apiError(400, 'invalid_request', 'Missing file field');
  }
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    return apiError(413, 'payload_too_large', 'Image too large');
  }
  // mime 前置粗筛（浏览器所报）；最终以魔数为准，防改扩展名绕过
  if (!(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(file.type)) {
    return apiError(
      400,
      'invalid_request',
      `Unsupported image type, accepted: ${ACCEPTED_IMAGE_MIMES.join(', ')}`
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) {
    return apiError(400, 'invalid_request', 'File is not a valid PNG/JPEG/WebP image');
  }

  // 尺寸读取失败不阻断上传（降级：响应不含 width/height，前端回退 /raw 加载读 naturalWidth）
  const dimensions = await readImageDimensions(buffer);
  const asset = await createUploadedImageAsset({
    userId,
    title: fileBaseName(file.name) || '上传图片',
    imageBuffer: buffer,
    mime: imageTypeToMime(type),
    ext: imageTypeToExt(type)
  });

  return Response.json({ id: asset.id, ...dimensions });
}
