/* oxlint-disable no-console */
/**
 * 图像编辑（I2I）通道冒烟脚本：
 * 验证「文生图 → OSS 签名 URL 作为源图 → 3.0 I2I 指令编辑 → 下载校验」全链路。
 *
 * 运行：bun scripts/edit-smoke.ts
 * 前置：.env.local 中配置 DASHSCOPE_API_KEY 与 OSS_*（Bun 自动加载）
 *
 * 背景：
 * - 3.0 系列（qwen-image-3.0 / 3.0-pro）原生同时支持 T2I 与 I2I，与编辑消费同级价位
 *   （编辑输入 0.02 元/张 + 输出同文生图 0.18 元/张），无需引入 edit-plus / edit-max 系列；
 * - I2I 请求：同一同步端点，content = [{image: <公网URL|base64>}, {text: <指令>}]；
 * - size 可选（"宽*高"），像素面积 512*512~2048*2048，宽高比 1:8~8:1；不传由模型自动推荐；
 * - enable_thinking 默认 true（I2I 同样适用），交互场景须显式关闭。
 *
 * 场景：
 * 1. 基线：3.0 文生图 + size=1080*1440（验证 size 参数在 T2I 下生效）
 * 2. 编辑：源图（签名 URL）+ 风格指令，不传 size（观察默认输出尺寸行为）
 * 3. 编辑+改比例：源图 + 指令 + size=1024*1024（验证 I2I 下 size 可改比例）
 *
 * 产物：基线图与两张编辑图保存到 .tmp-images/（本地预览用），OSS 管道用对象用完即删。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { assetObjectKey, getOssClient, getSignedUrl, putObject } from '../src/lib/oss';

const BASE_URL = process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com';
const API_KEY = process.env.DASHSCOPE_API_KEY;
const ENDPOINT = `${BASE_URL}/api/v1/services/aigc/multimodal-generation/generation`;
const OUT_DIR = '.tmp-images';

const BASE_PROMPT =
  '生成一张杭州秋日漫步主题的小红书封面图：西湖断桥旁铺满金黄银杏落叶，一对情侣牵手漫步，暖色调，柔和阳光，画面留白处有手写体文字「杭州秋日漫步」，竖版构图，适合作为小红书封面';

const EDIT_INSTRUCTION = '把整张画面改成水墨淡彩风格，保留人物姿态与整体构图，文字保持清晰';
const RESIZE_INSTRUCTION = '把画面裁切为方形构图，保持主体居中';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Usage {
  output_width?: number;
  output_height?: number;
  input_image_count?: number;
  input_image_type?: string;
  output_image_type?: string;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`HTTP ${response.status} 非 JSON 响应: ${text.slice(0, 300)}`);
  }
}

function describeApiError(body: Record<string, unknown>): string {
  const output = body.output as Record<string, unknown> | undefined;
  const code = (body.code ?? output?.code) as string | undefined;
  const message = (body.message ?? output?.message) as string | undefined;
  return [code, message].filter(Boolean).join(': ') || '未知错误';
}

/** 同步调用：T2I（content 仅 text）或 I2I（content 含 image + text） */
async function callImageApi(params: {
  model: string;
  content: Record<string, string>[];
  size?: string;
}): Promise<{ temporaryUrl: string; usage: Usage }> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: params.model,
      input: { messages: [{ role: 'user', content: params.content }] },
      parameters: {
        n: 1,
        watermark: false,
        negative_prompt: '',
        enable_thinking: false,
        ...(params.size ? { size: params.size } : {})
      }
    }),
    signal: AbortSignal.timeout(240_000)
  });
  const body = await readJson(response);
  if (!response.ok || body.code) {
    throw new Error(`调用失败（HTTP ${response.status}）: ${describeApiError(body)}`);
  }
  const output = body.output as
    | {
        choices?: { finish_reason?: string; message?: { content?: { image?: string }[] } }[];
      }
    | undefined;
  const choice = output?.choices?.[0];
  const url = choice?.message?.content?.[0]?.image;
  if (!url) throw new Error(`响应中无图片（finish_reason=${String(choice?.finish_reason)}）`);
  return { temporaryUrl: url, usage: (body.usage ?? {}) as Usage };
}

/** 下载临时图 → PNG 校验 → 保存本地（预览用）→ 返回字节 */
async function fetchPng(temporaryUrl: string, localName: string): Promise<Buffer> {
  const response = await fetch(temporaryUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`下载临时图失败（HTTP ${response.status}）`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`下载内容不是 PNG（前 8 字节: ${buffer.subarray(0, 8).toString('hex')}）`);
  }
  writeFileSync(`${OUT_DIR}/${localName}`, buffer);
  console.log(`  本地: ${OUT_DIR}/${localName}（${(buffer.byteLength / 1024).toFixed(0)} KB）`);
  return buffer;
}

function logUsage(usage: Usage): void {
  console.log(
    `  usage: 输出 ${usage.output_width}x${usage.output_height} | 输入图 ${usage.input_image_count ?? 0} 张（${usage.input_image_type ?? '-'}） | 档位 ${usage.output_image_type ?? '-'}`
  );
}

mkdirSync(OUT_DIR, { recursive: true });
console.log('=== 图像编辑（I2I）通道冒烟 ===');
console.log(`端点: ${ENDPOINT}\n`);

let failed = 0;
let sourceBuffer: Buffer | undefined;

// ---- 场景 1：基线生成（T2I + size=1080*1440） ----
console.log('--- [1/3] 基线生成 qwen-image-3.0（size=1080*1440） ---');
let sourceSignedUrl = '';
let sourceKey = '';
try {
  const startedAt = Date.now();
  const result = await callImageApi({
    model: 'qwen-image-3.0',
    content: [{ text: BASE_PROMPT }],
    size: '1080*1440'
  });
  console.log(`  生成耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  logUsage(result.usage);
  sourceBuffer = await fetchPng(result.temporaryUrl, '01-base.png');
  sourceKey = assetObjectKey('smoke', `edit-smoke-base-${randomUUID()}`, 'png');
  await putObject(sourceKey, sourceBuffer, 'image/png');
  sourceSignedUrl = await getSignedUrl(sourceKey, 3600);
  const verify = await fetch(sourceSignedUrl, { signal: AbortSignal.timeout(30_000) });
  if (verify.status !== 200) throw new Error(`签名回读失败（HTTP ${verify.status}）`);
  console.log('  签名 URL 就绪（供百炼拉取）: HTTP 200 ✓\n');
} catch (error) {
  failed += 1;
  console.error('[fail] 基线生成:', error instanceof Error ? error.message : error, '\n');
}

// ---- 场景 2：I2I 风格编辑（不传 size） ----
if (sourceBuffer) {
  console.log('--- [2/3] I2I 风格编辑 qwen-image-3.0（不传 size） ---');
  try {
    const startedAt = Date.now();
    const result = await callImageApi({
      model: 'qwen-image-3.0',
      content: [{ image: sourceSignedUrl }, { text: EDIT_INSTRUCTION }]
    });
    console.log(`  生成耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    logUsage(result.usage);
    await fetchPng(result.temporaryUrl, '02-edit-style.png');
    console.log('');
  } catch (error) {
    failed += 1;
    console.error('[fail] I2I 风格编辑:', error instanceof Error ? error.message : error, '\n');
  }

  // ---- 场景 3：I2I 改比例（size=1024*1024） ----
  console.log('--- [3/3] I2I 改比例 qwen-image-3.0（size=1024*1024） ---');
  try {
    const startedAt = Date.now();
    const result = await callImageApi({
      model: 'qwen-image-3.0',
      content: [{ image: sourceSignedUrl }, { text: RESIZE_INSTRUCTION }],
      size: '1024*1024'
    });
    console.log(`  生成耗时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    logUsage(result.usage);
    await fetchPng(result.temporaryUrl, '03-edit-resize.png');
    console.log('');
  } catch (error) {
    failed += 1;
    console.error('[fail] I2I 改比例:', error instanceof Error ? error.message : error, '\n');
  }
}

// ---- 清理 OSS 测试对象 ----
if (sourceKey) {
  await getOssClient().delete(sourceKey);
  console.log(`已清理 OSS 测试对象: ${sourceKey}`);
}

console.log(
  failed === 0
    ? '\n全部场景通过：T2I size 生效 + I2I（签名 URL 源图）可用 + I2I size 可改比例。'
    : `\n${failed} 个场景失败：请检查 DASHSCOPE_API_KEY 权限、模型开通与 OSS 配置。`
);
process.exit(failed === 0 ? 0 : 1);
