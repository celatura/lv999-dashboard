import { INSUFFICIENT_CREDITS_MESSAGE } from '@/features/credits/constants/credits';
import { MODEL_UNAVAILABLE_MESSAGES } from '../constants/models';

export function resolveChatError(error: unknown): {
  message: string;
  isSizeLimit: boolean;
  requiresSettingsSync: boolean;
  requiresReconnect?: boolean;
  /** 服务端错误码（用于渲染针对性的操作按钮，如 unknown_skill → 编辑输入） */
  code?: string;
} {
  const raw = error instanceof Error ? error.message : String(error);
  if ((MODEL_UNAVAILABLE_MESSAGES as readonly string[]).includes(raw)) {
    return { message: raw, isSizeLimit: false, requiresSettingsSync: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const envelope = parsed.error;
      if (typeof envelope === 'object' && envelope !== null && 'code' in envelope) {
        if (envelope.code === 'insufficient_credits') {
          return {
            message: INSUFFICIENT_CREDITS_MESSAGE,
            isSizeLimit: false,
            requiresSettingsSync: false
          };
        }
        if (envelope.code === 'payload_too_large') {
          return {
            message: '会话消息或请求内容过多，请缩短输入或新建会话后继续。',
            isSizeLimit: true,
            requiresSettingsSync: false
          };
        }
        if (envelope.code === 'settings_changed') {
          return {
            message: '会话的模型已发生变化，请同步后重试。',
            isSizeLimit: false,
            requiresSettingsSync: true
          };
        }
        if (envelope.code === 'unknown_skill') {
          return {
            message: '所选技能不存在或已删除，请重新选择后发送。',
            isSizeLimit: false,
            requiresSettingsSync: false,
            code: 'unknown_skill'
          };
        }
        if (envelope.code === 'stream_changed') {
          return {
            message: '该会话的生成状态已变化，请等待当前生成完成后重试。',
            isSizeLimit: false,
            requiresSettingsSync: false
          };
        }
        if (envelope.code === 'stream_unavailable') {
          return {
            message: '生成流尚未准备好或无法恢复，请重新连接或停止生成。',
            isSizeLimit: false,
            requiresSettingsSync: false,
            requiresReconnect: true
          };
        }
      }
    }
  } catch {
    // 流内错误和网络错误不一定是 JSON 信封。
  }
  return {
    message: '生成出错了，请重试。',
    isSizeLimit: false,
    requiresSettingsSync: false
  };
}
