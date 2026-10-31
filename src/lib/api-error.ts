/**
 * API 错误响应统一信封（Server 侧）。
 *
 * 约定：所有 Route Handler 的可预期错误一律通过 `apiError()` 返回
 * `{ error: { code, message } }` JSON —— `code` 供客户端程序化判断
 * （客户端封装为 `ApiError.code`），`message` 为简短英文描述，
 * 面向用户的中文文案由客户端决定。
 *
 * 例外：`generation_failed`（图片/视频生成失败）的 `message` 直接透传
 * `GenerationError` 的用户可读中文（见 features/agent/api/image-generation.ts
 * 的 `toUserFacingError`）—— 生成失败原因（审核拒绝 / 限流 / 参数 / 超时）
 * 由服务端单一来源判定，客户端按 code 识别后原样展示，不再二次映射。
 */

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_json'
  | 'invalid_request'
  | 'not_found'
  | 'payload_too_large'
  | 'settings_changed'
  | 'stream_changed'
  | 'stream_unavailable'
  | 'too_many_requests'
  | 'insufficient_credits'
  | 'generation_failed'
  | 'not_implemented';

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  headers?: HeadersInit
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}
