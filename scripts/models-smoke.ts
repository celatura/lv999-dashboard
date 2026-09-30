/* oxlint-disable no-console */
/**
 * 模型通道冒烟脚本：验证百炼 4 个对话模型可用且支持工具调用。
 * （想一并自查图片/视频/embedding 通道与「模型已下线」识别，跑 scripts/model-audit.ts）
 *
 * 运行：bun run scripts/models-smoke.ts
 * 前置：.env.local 中配置 DASHSCOPE_API_KEY
 */
import { generateText, isStepCount, tool } from 'ai';
import { z } from 'zod';
import { MODEL_KEYS } from '../src/features/agent/constants/models';
import { resolveModel } from '../src/features/agent/api/provider';

const echo = tool({
  description: '记录一段文字，用于配置验证',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => ({ recorded: text })
});

let failed = 0;

for (const key of MODEL_KEYS) {
  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: resolveModel(key),
      prompt: '调用 echo 工具记录文字 "ping"，然后用一句话回复确认。',
      tools: { echo },
      stopWhen: isStepCount(3)
    });
    const toolCalls = result.toolCalls.length;
    console.log(
      `[ok] ${key} | ${Date.now() - startedAt}ms | 工具调用 ${toolCalls} 次 | ${result.text.slice(0, 60)}`
    );
    if (toolCalls === 0) {
      console.warn(`[warn] ${key} 未触发工具调用，请确认该模型支持 function calling`);
    }
  } catch (error) {
    failed += 1;
    console.error(`[fail] ${key}:`, error instanceof Error ? error.message : error);
  }
}

console.log(
  failed === 0
    ? '\n全部模型可用。'
    : `\n${failed} 个模型失败：请检查 DASHSCOPE_API_KEY，以及百炼控制台中的实际 model ID（如 deepseek-v4.1-flash / deepseek-v4-pro）；若报 403 access_denied，优先怀疑模型已下线或未开通。`
);
process.exit(failed === 0 ? 0 : 1);
