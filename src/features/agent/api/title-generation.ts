import type { AlibabaLanguageModelChatOptions } from '@ai-sdk/alibaba';
import { generateText } from 'ai';
import { buildConversationTitle, DEFAULT_CONVERSATION_TITLE } from '../constants/conversation';
import { DEFAULT_MODEL } from '../constants/models';
import { stripAssetReferenceBlock } from '../lib/asset-reference';
import type { UsageSink } from './agent';
import { resolveModel } from './provider';

const MAX_TITLE_PROMPT_LENGTH = 2000;
const TITLE_TIMEOUT_MS = 8000;
const TITLE_MAX_OUTPUT_TOKENS = 60;

const TITLE_INSTRUCTIONS = `根据用户的创作需求生成一个简短的中文会话标题（4-12 个字），概括主题。
只输出标题本身：不要引号、书名号、序号、前缀或解释。`;

/**
 * LLM 会话标题：默认廉价模型生成，与主生成并行、不阻塞流。
 * 失败 / 超时回退首条消息截断（buildConversationTitle），保证标题始终可得。
 * usage 计入对话 UsageSink 随本次 chat 一并结算（预留预算已含余量，见 docs/credits.md）。
 */
export async function generateConversationTitle(
  userText: string,
  usageSink?: UsageSink
): Promise<string> {
  const fallback = buildConversationTitle(userText);
  const prompt = stripAssetReferenceBlock(userText).slice(0, MAX_TITLE_PROMPT_LENGTH).trim();
  if (!prompt) return fallback;
  try {
    const { text, usage } = await generateText({
      model: resolveModel(DEFAULT_MODEL),
      instructions: TITLE_INSTRUCTIONS,
      prompt,
      maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
      // 标题调用关闭思考：默认思考会把小额输出预算耗尽（reasoningTokens 占满、text 为空）。
      // satisfies 让选项名/类型对齐 provider schema：拼错在编译期报错，而不是被静默剥离。
      providerOptions: {
        alibaba: { enableThinking: false } satisfies AlibabaLanguageModelChatOptions
      },
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS)
    });
    if (usageSink) {
      usageSink.inputTokens += usage.inputTokens ?? 0;
      usageSink.outputTokens += usage.outputTokens ?? 0;
    }
    const cleaned = text.replace(/^[#*"'《\s]+/, '').replace(/["'》\s]+$/, '');
    const title = buildConversationTitle(cleaned);
    return title === DEFAULT_CONVERSATION_TITLE ? fallback : title;
  } catch (error) {
    console.warn('[agent] title generation failed, falling back to truncation', error);
    return fallback;
  }
}
