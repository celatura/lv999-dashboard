/* oxlint-disable no-console */
/**
 * 图片生成通道冒烟脚本：
 * 对注册表中的图片模型各生成一张测试图，并完成「调用百炼 → 下载临时图 → 转存 OSS → 签名回读」全链路验证。
 *
 * 运行：bun scripts/image-smoke.ts
 * 前置：.env.local 中配置 DASHSCOPE_API_KEY 与 OSS_*（Bun 自动加载 .env.local）
 *
 * 当前注册表（3.0 系列，同步协议；参数与生产一致，含 enable_thinking: false）：
 * - qwen-image-3.0（默认）：~25s
 * - qwen-image-3.0-pro：~35s
 * 端点：POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 * （经典域名实测可用；官方新式工作空间子域名亦可）
 */
import { randomUUID } from 'node:crypto';
import { assetObjectKey, getSignedUrl, putObject } from '../src/lib/oss';

const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com';
const API_KEY = process.env.DASHSCOPE_API_KEY;

const PROMPT =
  '生成一张杭州秋日漫步主题的小红书封面图：西湖断桥旁铺满金黄银杏落叶，一对情侣牵手漫步，暖色调，柔和阳光，画面留白处有手写体文字「杭州秋日漫步」，适合作为小红书封面';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface GenerateResult {
  /** 百炼返回的临时图片 URL（24h 有效，脚本内部即转存 OSS，不外泄） */
  temporaryUrl: string;
  /** 调用形态说明 */
  callShape: string;
  /** 响应结构关键字段说明 */
  responseNotes: string;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

/** 读取响应文本并尝试 JSON 解析；非 JSON（如网关 HTML 报错）时抛出含片段的错误 */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${response.status} 非 JSON 响应: ${text.slice(0, 300)}`);
  }
}

/** 从响应体中提取错误码/信息（百炼错误在顶层 code/message 或 output.code/message） */
function describeApiError(body: Record<string, unknown>): string {
  const output = body.output as Record<string, unknown> | undefined;
  const code = (body.code ?? output?.code) as string | undefined;
  const message = (body.message ?? output?.message) as string | undefined;
  return [code, message].filter(Boolean).join(': ') || '未知错误';
}

/** 同步协议：一次请求返回结果（参数与生产一致：n=1、关闭 thinking） */
async function generateViaSync(model: string): Promise<GenerateResult> {
  const endpoint = `${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model,
      input: { messages: [{ role: 'user', content: [{ text: PROMPT }] }] },
      parameters: { n: 1, watermark: false, negative_prompt: '', enable_thinking: false }
    }),
    signal: AbortSignal.timeout(180_000)
  });
  const body = await readJson(response);
  if (!response.ok || body.code) {
    throw new Error(`同步调用失败（HTTP ${response.status}）: ${describeApiError(body)}`);
  }
  const output = body.output as
    | {
        choices?: { finish_reason?: string; message?: { content?: { image?: string }[] } }[];
      }
    | undefined;
  const choice = output?.choices?.[0];
  const url = choice?.message?.content?.[0]?.image;
  if (!url) throw new Error(`响应中无图片（finish_reason=${String(choice?.finish_reason)}）`);
  return {
    temporaryUrl: url,
    callShape: '同步（单次请求等待结果）',
    responseNotes: `output.choices[0].message.content[0].image（finish_reason=${String(choice?.finish_reason)}）`
  };
}

/** 下载临时图 → 校验 PNG → 转存 OSS → 签名回读断言 200 */
async function persistToOss(candidateKey: string, temporaryUrl: string): Promise<void> {
  const imageResponse = await fetch(temporaryUrl, { signal: AbortSignal.timeout(60_000) });
  if (!imageResponse.ok) throw new Error(`下载临时图失败（HTTP ${imageResponse.status}）`);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`下载内容不是 PNG（前 8 字节: ${buffer.subarray(0, 8).toString('hex')}）`);
  }
  console.log(`  下载: ${(buffer.byteLength / 1024).toFixed(0)} KB，PNG 魔数校验通过`);

  const key = assetObjectKey('smoke', `${candidateKey}-${randomUUID()}`, 'png');
  await putObject(key, buffer, 'image/png');
  console.log(`  OSS: ${key}`);

  const signedUrl = await getSignedUrl(key, 300);
  const verifyResponse = await fetch(signedUrl, { signal: AbortSignal.timeout(30_000) });
  if (verifyResponse.status !== 200) {
    throw new Error(`签名回读失败（HTTP ${verifyResponse.status}）`);
  }
  console.log('  签名回读: HTTP 200 ✓');

  // 下载路径验证：带 content-disposition 覆盖的签名 URL 应返回附件响应头
  // （OSS 不允许覆盖 content-type，故只验证 disposition）
  const downloadUrl = await getSignedUrl(key, 300, {
    contentDisposition: `attachment; filename*=UTF-8''smoke-image.png`
  });
  const downloadResponse = await fetch(downloadUrl, { signal: AbortSignal.timeout(30_000) });
  const disposition = downloadResponse.headers.get('content-disposition') ?? '';
  if (downloadResponse.status !== 200 || !disposition.includes('attachment')) {
    throw new Error(
      `带响应覆盖的签名 URL 校验失败（HTTP ${downloadResponse.status}，disposition=${disposition}）`
    );
  }
  console.log(`  签名下载头: ${disposition} ✓`);
}

const candidates = ['qwen-image-3.0', 'qwen-image-3.0-pro'];

console.log('=== 图片生成通道冒烟 ===');
console.log(`端点基址: ${BASE_URL}`);
console.log(`候选模型: ${candidates.join(', ')}\n`);

let failed = 0;
for (const [index, model] of candidates.entries()) {
  console.log(`--- [${index + 1}/${candidates.length}] ${model} ---`);
  const startedAt = Date.now();
  try {
    const result = await generateViaSync(model);
    console.log(`  调用形态: ${result.callShape}`);
    console.log(`  响应字段: ${result.responseNotes}`);
    console.log(`  生成耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    await persistToOss(model, result.temporaryUrl);
    console.log(
      `[ok] ${model} 全链路通过（总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）\n`
    );
  } catch (error) {
    failed += 1;
    console.error(`[fail] ${model}:`, error instanceof Error ? error.message : error);
    console.error('');
  }
}

console.log(
  failed === 0
    ? '全部候选模型可用（生成 + 转存 OSS + 签名回读）。'
    : `${failed} 个候选失败：请检查 DASHSCOPE_API_KEY 权限与百炼控制台中的模型开通情况。`
);
process.exit(failed === 0 ? 0 : 1);
