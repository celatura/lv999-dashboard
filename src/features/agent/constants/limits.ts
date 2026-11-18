/**
 * Agent 模块请求体上限（chat 与 stop 端点共用）。
 * Vercel 函数请求体上限为 4.5MB，这里留出余量。
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** 生图/改图限流：付费模型调用（≈0.18-0.20 元/次），20 次/分/用户（直连端点与聊天工具共用） */
export const IMAGE_RATE_LIMIT = 20;
export const IMAGE_RATE_WINDOW_SECONDS = 60;

/**
 * 聊天图片附件客户端预检（UX 用；服务端权威校验在 lib/upload-image.ts，口径一致）。
 * 不直接 import upload-image.ts——它依赖 sharp（server-only）。
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_ATTACHMENT_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
