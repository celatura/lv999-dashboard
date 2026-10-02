# 视频产物模块

LV999 Dashboard 的动态内容创作能力：在「文本 / 图片 / 设计」之上，新增**视频**作为第 5 类资产（`kind='video'`）。Agent 对话中经 `createVideoAsset`（文生视频 T2V）与 `createVideoFromImageAsset`（图生视频 I2V）产出短视频，统一沉淀为可管理资产。

> 视频生成走 **AI SDK v7 `experimental_generateVideo`** + **`@ai-sdk/alibaba` 的 `videoModel()`**（默认模型 `wan3.0-video`）；provider 内部完成「提交异步任务 → 轮询 → 下载字节」全流程。视频存 OSS，封面经 **OSS 原生视频截帧** + 同源代理下发。**零新增 npm 依赖、零新增外部服务、零 DB 迁移、零新增环境变量**。

---

## 1. 概览

- **入口**：仅在 Agent 对话内（`/dashboard/agent/[conversationId]`）；产出在 `/dashboard/assets`（我的资产）统一管理。**MVP 无直连视频端点**（不走聊天）。
- **两类生成**：T2V（纯文本 prompt）/ I2V（以已有图片资产作首帧，记录血缘）。
- **模型**：默认 `wan3.0-video`（官方推荐最新，统一 T2V + I2V，原生音画同步）；`wan3.0-video-prime`（优速版）可显式指定。
- **落库**：复用 `assets` 表，`kind='video'` / `mime='video/mp4'` / `storageKey`（OSS `.mp4`）/ `content`（生成 prompt，可溯源）。
- **封面**：OSS 视频截帧（`x-oss-process=video/snapshot`）动态生成，经 `/raw?snapshot=1` 同源代理；列表/卡片**不渲染 `<video>`**，只渲染封面图。

---

## 2. 依赖与约束

- **零新依赖**：复用 `ai`（`experimental_generateVideo`）与 `@ai-sdk/alibaba`（`videoModel()`），无 bunfig 7 天冷却问题。
- **无 DB 迁移**：`assets` 表的 `kind`/`mime`/`storageKey`/`sizeBytes`/`sourceAssetId`/`favorite` 已通用；`kind='video'` 是纯扩展（`ASSET_KIND_VALUES` 单一来源）。
- **国内地域端点**：`@ai-sdk/alibaba` 的 `videoBaseURL` 默认指向 `dashscope-intl`（新加坡）；本项目为国内 key，[`provider.ts`](../src/features/agent/api/provider.ts) 用**独立单例** `getAlibabaVideoProvider()` 显式覆盖为经典域名 `https://dashscope.aliyuncs.com`（DashScope 原生协议，与对话/嵌入的 OpenAI 兼容端点隔离）。
- **红线**：任务成功返回的临时 `video_url` 24h 有效，由 SDK 内部立即下载，**不外泄、不落库**；持久化只存 OSS `storageKey`。

---

## 3. 数据模型（复用 assets 表，kind='video'）

video 是 assets 的第 5 类（见 [`agent/constants/kinds.ts`](../src/features/agent/constants/kinds.ts)：`markdown` / `html` / `image` / `design` / `video`）。落库约定（[`service.ts`](../src/features/agent/api/service.ts) 的 `createVideoAsset`，仿 `createImageAsset` 的「预生成 id → putObject → 一次性 insert」）：

| 字段 | video 资产取值 |
| --- | --- |
| `kind` | `'video'` |
| `mime` | `'video/mp4'` |
| `storageKey` | OSS 对象 key：`assets/{userId}/{assetId}.mp4` |
| `sizeBytes` | 视频字节数（上限 100MB） |
| `content` | 生成 prompt（可溯源，与图片一致） |
| `source` | `'agent'` |
| `sourceAssetId` | I2V 派生视频指向源图片资产（T2V 为 null；源删除 `SET NULL`） |
| `favorite` | 复用（任意 kind 可收藏） |

> **无 `duration` 列**：`assets` 表无 jsonb 元数据列且禁止迁移，视频时长无处落库，故表格**不展示时长徽标**（见 §9 偏差 5）。

---

## 4. 视频生成通道（`src/features/agent/api/video-generation.ts`）

复用 AI SDK 的 `experimental_generateVideo`，provider 内置轮询，**比图片模块 `image-generation.ts` 的手写轮询代码量少约 60%**。核心 `generateVideoAsset()`：

```ts
result = await generateVideo({
  model: resolveVideoModel(entry.providerModelId), // getAlibabaVideoProvider().videoModel(id)
  prompt: params.firstFrameUrl
    ? { image: params.firstFrameUrl, text: params.prompt } // I2V（首帧 + 文本，wan3.0 统一模型）
    : params.prompt,                                        // T2V（纯文本）
  aspectRatio: aspect,                    // 默认 '16:9'
  ...(resolution ? { resolution } : {}),  // 像素格式，adaptive/无对应尺寸时省略
  duration,                               // 2..10（MVP 硬上限），默认 5
  providerOptions: { alibaba: { promptExtend: true, watermark: false, audio: entry.supportsAudio } },
  poll: { intervalMs: 5_000, timeoutMs: 280_000 }, // 略小于 maxDuration=300，留转存/落库余量
  abortSignal: params.signal,             // 用户停止透传，同步取消轮询与下载
  maxRetries: 0                           // 视频成本高，不自动重试
});
```

**关键常量**：`MAX_VIDEO_SIZE_BYTES=100MB`、`MAX_VIDEO_DURATION_MVP=10`、`MIN_VIDEO_DURATION=2`、`VIDEO_POLL_INTERVAL_MS=5000`、`VIDEO_POLL_TIMEOUT_MS=280000`、`VIDEO_RATE_LIMIT=5`、`VIDEO_RATE_WINDOW_SECONDS=60`。

**下载校验**：仿图片模块的 PNG 魔数校验——校验 MP4 `ftyp` box（字节 4..8）+ 体积上限，拦截下载到的错误页/空响应。

**错误映射** `toUserFacingVideoError`：汇集错误链的 name/message/responseBody/code 做关键词匹配，映射为中文（内容审核 / 限流 / 鉴权欠费 / 参数 / 超时 / 下载失败）；用户停止优先判定（`signal.aborted` / AbortError）；详情走日志。

---

## 5. 模型注册表（`src/features/agent/constants/video-models.ts`）

与图片（`image-models.ts`）、对话（`models.ts`）注册表隔离。2026-09 模型审计（以百炼官方最新为准），2026-09-30 配合下线名单自查移除 wan2.6 后备条目：

| key | 展示名 | 模式 | 音画同步 | 时长 | 分辨率 | 定位 |
| --- | --- | --- | :-: | :-: | --- | --- |
| `wan3.0-video` | 万相 3.0 视频（推荐）| unified | ✅ | 2-30s | 480P/720P/1080P | **默认**（T2V + I2V）|
| `wan3.0-video-prime` | 万相 3.0 视频·优速 | unified | ✅ | 2-30s | 480P/720P/1080P | 优速版（生成更快）|

> 已移除 `wan2.6-t2v` / `wan2.6-i2v-flash`：官方已推荐 Wan 3.0，且两个条目没有任何调用路径（`agent.ts` 只传 `DEFAULT_VIDEO_MODEL` / `DEFAULT_I2V_MODEL`），留着只会扩大后续老旧模型退役批次的排查面。需要后备时按当时官方推荐重新登记，并用 `bun run scripts/model-audit.ts --video` 实测（480P×2s ≈ 0.6 元/条）。

- `DEFAULT_VIDEO_MODEL = DEFAULT_I2V_MODEL = 'wan3.0-video'`（统一模型，传首帧即走 I2V）。
- `VIDEO_ASPECT_KEYS = ['16:9','9:16','1:1','4:3','3:4','adaptive']`。
- **provider 契约要点**：顶层 `resolution` 需为 `${w}x${h}` 像素格式（provider 内部经 `resolutionTierMap` 映射回档位），故维护 `VIDEO_RESOLUTION_DIMENSIONS`（档 × 比例 → 像素）；`adaptive` 比例或该档无对应尺寸时 `resolveVideoResolution` 返回 undefined，仅由 `aspectRatio` 驱动。

---

## 6. Agent 集成（改 `src/features/agent/api/agent.ts`）

新增 2 个工具，**同时**登记到 `agentValidationTools` 与 `buildAgent.tools`（与现有 6 个工具并列，共 8 个）：

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `createVideoAsset` | `title` / `prompt` / `aspect?` / `duration?(2..10)` | 文生视频：限流 → `generateVideoAsset` → 转存 OSS → 入库 |
| `createVideoFromImageAsset` | `sourceAssetId` / `title` / `prompt` / `aspect?` / `duration?` | 图生视频：限流 → 校验源图（归属/`kind='image'`/`storageKey`/≤10MB）→ 签名 URL（TTL 900s）作首帧 → I2V → 入库（`sourceAssetId` 血缘）|

- **限流在工具内执行**（scope `video`，5 次/分）：MVP 视频仅走流式 chat 路由，**无法返回 HTTP 429**，改为 `execute` 入口 `checkRateLimit` 命中即抛中文错误（「视频生成过于频繁…」），由对话内视频卡片展示（见 §9 偏差 4）。
- `readAsset` 扩展：video 返回其生成 prompt（视频像素不进上下文；暂不支持在视频基础上直接编辑）。
- **指令更新**（`AGENT_INSTRUCTIONS` 第 11 条）：何时用视频、耗时提示（1-5 分钟，调用前告知用户、不重复调用）、prompt 自包含（主体/动作/场景/氛围/镜头运动）、参数选择（默认 16:9 / 5s，竖版 9:16）、I2V 用 `createVideoFromImageAsset`、成本约束（一次对话不生成多个视频）、失败处理（不重试超过 1 次）。

---

## 7. 视频封面（OSS 截帧 + 同源代理）★

列表/卡片若直接渲染 `<video>`，10+ 视频会并发建立连接 + 下载 moov box 阻塞页面（移动端 Safari 强制禁用预加载）。故**列表不渲染 `<video>`**，改用封面图：

- **签名**（[`oss.ts`](../src/lib/oss.ts) 的 `videoSnapshotUrl`）：经 ali-oss `signatureUrl({ process: 'video/snapshot,t_,f_,w_,m_' })` 下发截帧参数——**该参数被纳入签名**（私有桶必需；不能先签名再手动拼 `&x-oss-process`，否则 `SignatureDoesNotMatch`）。默认第 1 秒、jpg、宽 400px、fast 关键帧模式。
- **同源代理**（[`/api/agent/assets/[id]/raw?snapshot=1`](../src/app/api/agent/assets/[id]/raw/route.ts)）：复用设计画布的同源字节代理，带 `?snapshot=1` 且 `kind='video'` 时改用 `videoSnapshotUrl`（TTL 300s）签发封面帧 URL，同源流式回传（`Cache-Control: private, max-age=3600`）。**规避客户端签名与 CORS**——列表 `Asset` 不含 `storageKey`、客户端无法签名（见 §9 偏差 2）。
- **降级**：截帧失败（`upstream` 非 2xx 或对象缺失）→ 404，前端 `<img onError>` 回退类型图标 tile。

---

## 8. 前端

- **对话内视频卡片**（[`tool-video-part.tsx`](../src/features/agent/components/chat/tool-video-part.tsx)）：进行中（1-5 分钟）→ 状态条「正在生成视频…（预计 1-5 分钟；离开页面也会继续）」；完成 → `<video controls preload='metadata' poster='/raw?snapshot=1' src={previewUrl}>`（src 走详情端点签发的 `previewUrl` 直连 OSS，原生支持 Range 可拖动进度；poster 走同源截帧代理）；失败 → 中文错误条。**保留 wan3.0 原生音频，不静音**。非流式（`active=false`）时进行中 part 渲染中性「已停止」收尾（与图片卡片同理，避免残留转圈）。
- **消息渲染**（[`message-item.tsx`](../src/features/agent/components/chat/message-item.tsx)）：`tool-createVideoAsset` / `tool-createVideoFromImageAsset` 两个 part 类型均路由到 `ToolVideoPart`。
- **预览弹窗**（[`asset-preview-dialog.tsx`](../src/features/agent/components/assets/asset-preview-dialog.tsx)）：video 分支 `<video controls autoPlay muted playsInline preload='metadata' poster='/raw?snapshot=1' src={previewUrl}>`（autoPlay+muted 保证可靠自动播放，可手动取消静音）；I2V 派生视频显示「基于《源图标题》修改」。
- **资产表格缩略图**（[`asset-tables/columns.tsx`](../src/features/agent/components/assets/asset-tables/columns.tsx) 的 `AssetThumb`）：视频经 `/raw?snapshot=1` 加载 36px 截帧封面 + 播放图标 overlay（`Icons.play`）；kind 筛选下拉自动含「视频」（`ASSET_KINDS` 单一来源）。
- **下载**（[`assets/[id]/download`](../src/app/api/agent/assets/[id]/download/route.ts)）：video 有 `storageKey`，走 302 签名 URL，扩展名映射 `video → mp4`。

---

## 9. 与 PRD 的必要偏差（落地修正）

实现相对规划阶段的 PRD 有 5 处必要偏差，均为让功能真正可用的修正（PRD 已随功能完成归档删除，此处记录偏差以免后续重蹈覆辙）：

1. **Agent 超时 240s → 295s**：原 `timeout.totalMs=240_000` 会在 280s 视频轮询完成前中止长视频。提升到 **295s**（[`agent.ts`](../src/features/agent/api/agent.ts)），仍 < Route Handler `maxDuration=300`（平台硬杀）。超时链路：`maxDuration=300` ▸ `Agent totalMs=295` ▸ `VIDEO_POLL_TIMEOUT_MS=280`（逐层留余量给转存/落库与平台）。
2. **封面截帧改服务端签名 + 同源代理**：PRD 原拟「客户端 `videoSnapshotUrl(storageKey)` 手动拼 `&x-oss-process`」**不可行**——列表 `Asset` 不含 `storageKey`、客户端无法签名、手动拼接破坏私有桶签名。改用 ali-oss `signatureUrl({ process })` 正确签名，经 `/raw?snapshot=1` 同源下发（复用现有缩略图代理，规避 CORS）。
3. **默认模型统一为 `wan3.0-video`**：PRD 注册表与常量曾自相矛盾；按可行性结论 + 验收清单定为 `wan3.0-video`（统一 T2V/I2V），`DEFAULT_I2V_MODEL` 亦指向它。
4. **限流在工具内执行**（scope `video`，5 次/分）：MVP 视频仅走流式 chat 路由，无法返回 HTTP 429；改为工具 `execute` 入口 `checkRateLimit` 命中即抛中文错误，由视频卡片展示。
5. **表格时长徽标跳过**：`assets` 表无 jsonb 列且禁止迁移，`duration` 无处落库（PRD 的 MVP「做」清单亦未含此项），故列表不展示时长。

---

## 10. 关键约束

- **超时链路对齐**：`VIDEO_POLL_TIMEOUT_MS(280s) < Agent totalMs(295s) < maxDuration(300s)`，任一环收紧都需同步其余两层，否则长视频被提前中止或平台硬杀。
- **临时 URL 不外泄**：`video_url` 由 SDK 内部下载转存 OSS，任何持久化字段不得存临时 URL。
- **封面必须服务端签名**：截帧 `process` 参数纳入 OSS 签名，客户端只经 `/raw?snapshot=1` 同源访问，不手动拼 URL。
- **成本防线**：限流 5 次/分（工具内）+ `maxRetries=0` + MVP 时长 ≤10s / 720P + 指令「一次对话不生成多个视频」。

---

## 11. 明确延后（未实现）

直连 T2V/I2V 端点（`/api/agent/videos`，MVP 仅走对话）、视频编辑（V2V / 参考生视频 r2v）、多镜头叙事 UI（`shotType`）、音频文件传入（`audioUrl`）、水印/seed/分辨率选择器 UI、时长元数据落库与徽标、视频缩略图预生成存储（当前 OSS 动态截帧）、本地视频上传。

---

## 12. 手动验收清单

- **P0 冒烟**（[`scripts/video-smoke.ts`](../scripts/video-smoke.ts)）：`bun scripts/video-smoke.ts` → wan3.0-video 生成 5s/720P/16:9 → 下载 → 转存 OSS → 签名 URL 播放（Range 返回 200/206 + `video/*`）→ OSS 视频截帧封面（200 + `image/*`）全链路通过；首要验证国内端点 `videoBaseURL`。
- **T2V**：对话「生成一段小猫奔跑的 5 秒视频」→ Agent 调 `createVideoAsset` → 1-3 分钟内对话出现可播放视频卡片（poster 封面 + 可拖动进度 + 有声）。
- **I2V**：引用一张图片资产 →「把这张图做成动态视频」→ 产出视频资产，`sourceAssetId` 指向源图，预览弹窗显示「基于《源图标题》修改」。
- **停止**：生成中点击停止 → `abortSignal` 透传 → 轮询与下载立即取消，卡片显示「已停止」，不产生残留资产。
- **限流**：1 分钟内第 6 次视频请求 → 工具抛「视频生成过于频繁…」中文错误，卡片展示。
- **资产管理**：表格筛选 `kind=video`，**列表显示截帧封面 + 播放图标**（非 `<video>`）；预览弹窗播放；下载得 `.mp4`；可收藏 / 批量删除（复用现有端点）。
