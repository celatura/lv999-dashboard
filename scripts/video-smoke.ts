/* oxlint-disable no-console */
/**
 * 视频生成通道冒烟脚本：
 * 走「真实生产代码路径」验证——generateVideoAsset（AI SDK experimental_generateVideo + 国内 videoBaseURL）
 * → 下载视频字节 → 转存 OSS → 签名 URL 播放验证 → OSS 视频截帧封面验证。
 *
 * 运行：bun scripts/video-smoke.ts
 * 前置：.env.local 中配置 DASHSCOPE_API_KEY 与 OSS_*（Bun 自动加载 .env.local）
 *
 * 首要验证项：@ai-sdk/alibaba 的 videoBaseURL 默认为 dashscope-intl（新加坡），
 * 本项目为国内 key，provider.ts 已显式覆盖为 dashscope.aliyuncs.com（经典域名）。
 * 若此脚本报鉴权/地域错误 → 需切换直连百炼 REST 方案（仿 image-generation.ts 的 generateViaAsyncTask）。
 *
 * 默认模型 wan3.0-video（官方推荐，统一 T2V + I2V），5s / 720P / 16:9，异步任务耗时约 1-5 分钟。
 */
import { randomUUID } from 'node:crypto';
import { generateVideoAsset } from '../src/features/agent/api/video-generation';
import { assetObjectKey, getSignedUrl, putObject, videoSnapshotUrl } from '../src/lib/oss';

const PROMPT =
  '一只橘色小猫在洒满月光的草地上轻盈奔跑，慢镜头，月光柔和，草叶随风摆动，镜头缓慢跟随平移，电影感画面';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 签名 URL 播放验证：Range 请求应返回 206（支持拖动进度）或 200，且为 video/mp4 */
async function verifyPlayback(signedUrl: string): Promise<void> {
  const response = await fetch(signedUrl, {
    headers: { Range: 'bytes=0-65535' },
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`签名播放验证失败（HTTP ${response.status}，期望 200/206）`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const acceptRanges = response.headers.get('accept-ranges') ?? '';
  console.log(
    `  签名播放: HTTP ${response.status}，content-type=${contentType}，accept-ranges=${acceptRanges} ✓`
  );
  if (!contentType.startsWith('video/')) {
    throw new Error(`签名播放 content-type 异常（${contentType}，期望 video/*）`);
  }
}

/** OSS 视频截帧封面验证：可能需短暂等待对象就绪，重试数次；期望 200 + image/* */
async function verifySnapshot(storageKey: string): Promise<void> {
  const snapshotUrl = videoSnapshotUrl(storageKey, { time: 1000, width: 400, format: 'jpg' });
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(snapshotUrl, { signal: AbortSignal.timeout(30_000) });
    lastStatus = response.status;
    const contentType = response.headers.get('content-type') ?? '';
    if (response.status === 200 && contentType.startsWith('image/')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      console.log(
        `  视频截帧封面: HTTP 200，content-type=${contentType}，${(bytes.byteLength / 1024).toFixed(0)} KB ✓`
      );
      return;
    }
    console.warn(
      `  截帧未就绪（第 ${attempt} 次，HTTP ${response.status}，content-type=${contentType}），2s 后重试…`
    );
    await sleep(2_000);
  }
  throw new Error(
    `视频截帧封面验证失败（最后一次 HTTP ${lastStatus}）：请确认 OSS 桶已开通视频截帧能力`
  );
}

console.log('=== 视频生成通道冒烟（验证国内地域端点）===');
console.log(`模型: wan3.0-video（默认）  参数: 5s / 720P / 16:9`);
console.log(`提示词: ${PROMPT.slice(0, 40)}…\n`);

const startedAt = Date.now();
try {
  // 1) 生成 + 下载（走真实 provider：国内 videoBaseURL + AI SDK 内置轮询）
  const { videoBuffer, mime } = await generateVideoAsset({
    prompt: PROMPT,
    aspect: '16:9',
    duration: 5,
    resolution: '720P'
  });
  const genSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `  生成 + 下载: ${(videoBuffer.byteLength / 1024 / 1024).toFixed(2)} MB，mime=${mime}，耗时 ${genSeconds}s`
  );

  // 2) 转存 OSS
  const storageKey = assetObjectKey('smoke', `${randomUUID()}`, 'mp4');
  await putObject(storageKey, videoBuffer, mime);
  console.log(`  OSS: ${storageKey}`);

  // 3) 签名 URL 播放验证
  const signedUrl = await getSignedUrl(storageKey, 300);
  await verifyPlayback(signedUrl);

  // 4) OSS 视频截帧封面验证
  await verifySnapshot(storageKey);

  console.log(
    `\n[ok] 全链路通过（总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s）：` +
      '国内端点可用 + AI SDK 轮询下载 + OSS 转存 + 签名播放 + 视频截帧。'
  );
  console.log(`    可在浏览器打开签名 URL 播放：\n    ${signedUrl}`);
  process.exit(0);
} catch (error) {
  console.error('\n[fail] 视频冒烟失败：', error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause) {
    console.error('  cause:', error.cause);
  }
  console.error(
    '\n排查建议：\n' +
      '  1. 鉴权/地域错误 → 确认 DASHSCOPE_API_KEY 为国内 key，且 provider.ts 的 videoBaseURL=https://dashscope.aliyuncs.com\n' +
      '  2. 模型未开通 → 在百炼控制台开通 wan3.0-video\n' +
      '  3. 截帧失败 → 确认 OSS 桶已开通视频截帧（IMM/媒体处理）能力\n' +
      '  4. 端点仍不可用 → 切换直连百炼 REST 回退方案（仿 image-generation.ts 的 generateViaAsyncTask）'
  );
  process.exit(1);
}
