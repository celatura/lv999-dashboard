# Agent 创作模块

LV999 Dashboard 在后台骨架之上长出的核心业务模块：把「自然语言对话」转化为可沉淀、可管理的**内容资产**（Markdown / HTML / 图片 / 视频）。本文档描述其架构、数据模型、流式与停止机制、资产化设计、模型注册表与 API 契约。

> 该模块已接入**真实后端**（PostgreSQL + 阿里云 OSS + Redis + 阿里云百炼），非 Mock。运行前需配置对应环境变量（见文末）。
> 视频产物为 Phase 3 能力，架构与实现细节另见 [docs/video-generation.md](./video-generation.md)。

---

## 1. 概览

- **入口**：`/dashboard/agent`（新建会话）与 `/dashboard/agent/[conversationId]`（会话页）；产出在 `/dashboard/assets`（我的资产）统一管理。
- **编排**：AI SDK v7 `ToolLoopAgent`，每请求无状态构建，上下文经闭包注入工具。
- **工具**：`createAsset`（Markdown / HTML）、`createImageAsset`（文生图 T2I）、`editImageAsset`（图生图 I2I）、`createVideoAsset`（文生视频 T2V）、`createVideoFromImageAsset`（图生视频 I2V）、`composeDesign`（一句话生成整版设计）、`findAssets` / `readAsset`（资产复用）、`knowledgeSearch`（知识库语义检索）。
- **流式**：`resumable-stream` 可恢复 SSE，刷新 / 切回自动重连；停止走专用端点（跨实例真取消）。
- **持久化**：Drizzle ORM + PostgreSQL，三张表 `conversations` / `messages` / `assets`；图片 / 视频二进制存 OSS，库里只存 `storageKey`。
- **计费**：对话 / 生图 / 生视频 / 知识库摄取均经 Credits `checkBalance` 入口拦截（余额 ≤0 返回 402）、按真实 usage「发起后按结果扣」，杜绝陌生人刷爆作者 API Key；额度由管理员经**用户管理后台** `/dashboard/admin/users` 发放 / 设定（仅 `ADMIN_USER_IDS` 白名单）；详见 [docs/credits.md](./credits.md)。

---

## 2. 架构与目录

```plaintext
src/features/agent/
├── api/
│   ├── types.ts            # 类型契约（Conversation / ChatMessage / Asset / 过滤参数）
│   ├── service.ts          # 数据访问层（server-only）：会话 / 消息 / 资产的 DB + OSS 操作
│   ├── queries.ts          # TanStack Query options + 查询键工厂 agentKeys
│   ├── mutations.ts        # 会话增删改的 mutation options
│   ├── provider.ts         # resolveModel(key)：百炼直连 + 兼容模式兜底
│   ├── agent.ts            # buildAgent()、工具定义、agentValidationTools
│   ├── image-generation.ts # 图片生成通道（直连百炼 REST，T2I / I2I）
│   ├── image-edit.ts       # 图生图核心流程（工具与直连端点复用）
│   ├── video-generation.ts # 视频生成通道（AI SDK experimental_generateVideo + 内置轮询，T2V / I2V）
│   ├── rate-limit.ts       # 固定窗口 Redis 限流
│   └── stop-signal.ts      # 跨实例停止信号（Redis 标志 + 轮询）
├── components/
│   ├── chat/               # 对话窗口、消息项、工具 part 卡片、模型选择器
│   ├── assets/             # 资产卡片、列表、预览弹窗、资产表格
│   └── conversations/      # 会话列表
├── constants/
│   ├── models.ts           # 对话模型注册表（4 个文本模型）
│   ├── image-models.ts     # 图像模型注册表（2 个）+ 比例预设 ASPECT_PRESETS
│   ├── video-models.ts     # 视频模型注册表（wan3.0-video 默认 + prime 优速 + wan2.6 后备）
│   ├── skills.ts           # 技能注册表（专家模式，3 个预置技能）
│   ├── kinds.ts            # 资产类型元数据（markdown / html / image / design / video）
│   ├── conversation.ts     # 默认标题与标题生成
│   ├── embedding.ts        # RAG embedding 配置（模型 / 维度 / 批次）
│   └── limits.ts           # 请求体上限 MAX_REQUEST_BYTES
└── lib/                    # 前端辅助（如首条消息交接、资产引用块组装/解析）

src/app/api/agent/          # Route Handlers（REST / SSE）
src/lib/db/                 # Drizzle schema.ts 与 getDb()
src/lib/oss.ts              # OSS 客户端、对象 key、签名 URL
src/lib/redis.ts            # Redis 连接（getConnectedRedis）
src/lib/api-error.ts        # 统一错误信封 apiError()
```

**分层约定**：客户端组件 → `queries.ts` / `mutations.ts`（经 `apiClient` 调 `/api/agent/*`）→ Route Handler → `service.ts`（server-only）→ DB / OSS。客户端**不直接**引用 `service.ts`。

---

## 3. 数据模型

Drizzle schema 定义于 [`src/lib/db/schema.ts`](../src/lib/db/schema.ts)，共三张表：

### conversations（会话）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 默认随机生成 |
| `userId` | text | Clerk userId |
| `title` | text | 会话标题（首条消息自动生成） |
| `model` | text | 会话级模型选择，默认 `deepseek-flash` |
| `activeSkillId` | text \| null | 会话级技能（专家模式）id，指向代码内技能注册表；null = 通用（无技能） |
| `activeStreamId` | text \| null | 正在进行的可恢复流 id；无活跃流时为 null |
| `createdAt` / `updatedAt` | timestamptz | |

### messages（消息）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 与 AI SDK 消息 id 对齐 |
| `conversationId` | uuid FK → conversations | `ON DELETE CASCADE` |
| `role` | text | user / assistant 等 |
| `parts` | jsonb | 原样存储 AI SDK `UIMessage.parts` |
| `metadata` | jsonb \| null | 含 `streamId` 等 |
| `createdAt` | timestamptz | 索引：`(conversationId, createdAt)` |

### assets（资产）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 图片 / 视频资产由应用层预生成 id（先转存 OSS 再入库） |
| `conversationId` | uuid FK → conversations | `ON DELETE SET NULL`（会话删除，资产保留） |
| `sourceAssetId` | uuid FK → assets（自引用） | I2I / I2V 派生资产指向源图；`ON DELETE SET NULL` |
| `userId` | text | 归属用户 |
| `source` | text | `agent`（生成）/ `upload`（导入），默认 `agent` |
| `kind` | text | `markdown` / `html` / `image` / `design` / `video` |
| `title` | text | 资产标题 |
| `status` | text | 默认 `ready` |
| `favorite` | boolean | 用户收藏标记，默认 false；任意 kind 可收藏，列表支持「仅看收藏」筛选 |
| `content` | text \| null | 文本资产存正文；图片 / 视频资产存生成 prompt（可溯源）；design 资产存文档 JSON |
| `storageKey` | text \| null | OSS 对象 key（图片 / 视频 / design 预览 PNG 等二进制非空） |
| `mime` / `sizeBytes` | text / integer \| null | **`sizeBytes` 口径 = 下载产物体积**：有 `storageKey` 的二进制（image / video / design）记 OSS 对象字节（design = 预览 PNG 大小，非文档 JSON），无二进制时回退 `content` 字节 |
| `createdAt` / `updatedAt` | timestamptz | 索引：`(userId, createdAt)`、`(conversationId)` |

> **关键判据**：判断资产是否为二进制（走 OSS）用 `storageKey` 而非 `content`——图片资产的 `content` 列存的是 prompt（非 null）。

---

## 4. 对话与流式

### 4.1 可恢复流（resumable-stream）

生成路由 [`chat/route.ts`](../src/app/api/agent/chat/route.ts) 使用 `createUIMessageStreamResponse` + `toUIMessageStream`，并把流交给 `resumable-stream`：

- 生产者在无人订阅时把流写完整（`waitUntil(after)` 保活）。
- 每开新流先生成 `streamId` 并**立即**登记到 `conversations.activeStreamId`（防止窗口期刷新重连到旧流或拿 204）。
- 客户端 `useChat({ resume })` 按官方模式由服务端 `activeStreamId` 决定是否重连（仅存在活跃流时为 true）：有活跃流时挂载自动 `GET /api/agent/chat/[id]/stream` 重连（刷新 / 切回实时恢复）；无活跃流时不发重连请求（其 204 分支会把刚发送消息的 `submitted` 状态重置回 `ready`，导致发送按钮延迟变「停止」）。
- `streamId` 随响应消息 `metadata` 下发，供客户端停止时携带最新流 id。
- **必须提供 `generateMessageId`**：否则响应消息 id 为空串，会在 `messages` 主键上跨会话冲突（历史事故：串会话 + 消息丢失）。

### 4.2 新会话首条消息交接

新建会话时前端先 `createConversation` 拿到 id，再 `router.replace` 到会话页（**真实导航**，不能用 `history.replaceState`——否则 URL 与渲染树脱节、组件被复用、状态不重置）；首条消息经一次性交接由目标页发送。

### 4.3 停止信号（跨实例真取消）

见 [`stop-signal.ts`](../src/features/agent/api/stop-signal.ts) 与 [`chat/[id]/stop/route.ts`](../src/app/api/agent/chat/[id]/stop/route.ts)。serverless 多实例下无持久执行平台时的方案：

1. stop 端点保存客户端部分快照（`onConflictDoNothing`，只插不覆盖）。
2. 向 Redis 写入 `agent:stop:{streamId}` 标志（TTL 300s）。
3. 生成路由每 2 秒轮询该标志，命中后 `abort` 底层生成（真取消）。
4. 校验后清理 `activeStreamId`（仅当仍指向同一流，避免误清之后启动的新流）。

> **离开页面 / 卸载 ≠ 停止**：离开属于断开，应保持可恢复；只有点击停止按钮才真取消。

### 4.4 消息持久化纪律

`service.ts` 的 `syncConversationMessages` 采用「按所有权更新」：仅对本轮新产生的消息（`finalMessages` 超出 `originalMessages` 的尾部）执行冲突更新，其余旧消息一律 `onConflictDoNothing`，避免用陈旧客户端视图覆盖服务端较新版本。`cleanupSupersededResponses` 在新请求开始阶段清理被取代的残留 assistant 消息（带守卫，仅当目标 user 消息仍是会话最后一条）。

### 4.5 资产引用（`[引用资产]` 机器可读块）

用户在输入区点「引用资产」按钮（[`asset-reference-picker.tsx`](../src/features/agent/components/chat/asset-reference-picker.tsx)）从「我的资产」挑选若干资产，输入区上方展示为可移除 chip；提交时 [`buildAssetReferenceText`](../src/features/agent/lib/asset-reference.ts) 在用户原文前拼接机器可读块：

```
[引用资产]
- 《产品主图》 kind=image id=<uuid>
- 《秋日文案》 kind=markdown id=<uuid>

<用户原文>
```

- **为什么**：让模型**确定性地**拿到 assetId，无需再调 `findAssets` 检索（指令第 5 条明确「消息中出现 [引用资产] 块时，直接使用块内给出的 id」）。
- **仍是普通 text 消息**：不改流式协议、不影响 `validateUIMessages`。
- **解析**：[`parseAssetReferenceBlock`](../src/features/agent/lib/asset-reference.ts) 在气泡渲染与会话自动标题时剥离引用块只留用户原文（标题不应带机器可读块）。
- **标题归一**：标题内的换行 / 连续空白归一为单空格，避免破坏逐行解析。

---

## 5. Agent 与工具

`buildAgent()`（[`agent.ts`](../src/features/agent/api/agent.ts)）每请求构建一个 `ToolLoopAgent`：`stopWhen: isStepCount(6)`、`timeout.totalMs: 295_000`（需 ≥ 视频轮询上限 280s + 转存/落库，仍 < 路由 `maxDuration=300`）、`onStepEnd` / `onEnd` 记录 step / usage。工具：

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `createAsset` | `title` / `kind`(markdown\|html) / `content` | 文本作品直接落库 `assets.content`；`≤200KB`（`MAX_ASSET_SIZE_BYTES`）|
| `createImageAsset` | `title` / `prompt` / `aspect?` | 文生图：生成 → 立即下载 → 转存 OSS → 入库图片资产 |
| `editImageAsset` | `sourceAssetId` / `title` / `instruction` / `aspect?` | 图生图（I2I）：校验源图归属/kind/`storageKey`/≤10MB → 签名 URL 直传百炼 → 产出派生资产（`sourceAssetId` 记录血缘）|
| `createVideoAsset` | `title` / `prompt` / `aspect?` / `duration?(2..10)` | 文生视频（T2V）：工具内限流（video scope）→ `experimental_generateVideo`（内置轮询）→ 下载 → 转存 OSS → 入库视频资产；详见 [docs/video-generation.md](./video-generation.md) |
| `createVideoFromImageAsset` | `sourceAssetId` / `title` / `prompt` / `aspect?` / `duration?` | 图生视频（I2V）：限流 → 校验源图（归属/`kind='image'`/`storageKey`/≤10MB）→ 签名 URL（TTL 900s）作首帧 → I2V → 入库（`sourceAssetId` 血缘）|
| `findAssets` | `query?` / `kind?` / `limit?` | 按标题关键词 + 类型检索用户资产库，返回候选元信息（不含正文/URL）——按【标题】找「作品」供复用/改写 |
| `readAsset` | `assetId` | 读取资产内容：markdown/html 返回正文、image/video 返回生成 prompt（design 不支持），供“基于它再创作” |
| `knowledgeSearch` | `query` / `topK?` | 在 RAG 知识库中按【语义】检索「资料」片段（问答/综述），返回 topK 片段 + 来源标题；见 [docs/knowledge-base.md](./knowledge-base.md) |
| `composeDesign` | `title` / `imagePrompt` / `heading?` / `subheading?` / `layout`(top-image\|full-image-bar\|left-image) / `aspect?` | **一句话生成整版设计**：`checkBalance` → 文生图（计费 image 档，比例按**版式主图区域**选最接近的一档）→ `createImageAsset`（主图仍沉淀为独立资产）→ `sharp` 读自然尺寸 → [`design/lib/layouts.ts`](../src/features/design/lib/layouts.ts) 按版式组装文档（坐标/字号/对齐全由代码计算）+ sanitize → `createDesignAsset(previewPng=null)`；返回 `{ assetId, title, kind:'design', sizeBytes, imageAssetId }`，对话内渲染「打开编辑」卡片。design 落库为纯 JSON 组装，**不额外计费**；无预览（预览由画布保存时客户端导出补上）。详见 [docs/design-editor.md](./design-editor.md) |

> 区分：`findAssets` 按标题找「作品」（复用/改写/改图）；`knowledgeSearch` 按语义找「资料」（基于内容作答并标注来源）。对话中的 `[引用资产]` 块给出的 id 可直接使用，无需再检索。

工具校验用 `agentValidationTools`（与执行工具共享同一 Zod schema，**恒为全量 9 工具、不随技能过滤**），配合 `validateUIMessages` 对历史消息做进入模型前的校验（畸形历史 → 400 而非 500）。`buildAgent.tools` 则按当前技能的 `tools` 白名单过滤注册（见 §5.1）——两者必须分离：会话中途切技能后，旧消息可能含已被当前技能禁用的工具调用，若校验工具也过滤会导致历史校验 400。

### 5.1 技能系统（专家模式）

会话级「专家模式」：用户为一段会话选定一个技能，服务端在 `buildAgent` 处把技能指令与示例**追加**到基础指令后，并按技能的 `tools` 白名单过滤注册给模型的工具（能力边界，防误调昂贵工具）。

- **注册表**（[`constants/skills.ts`](../src/features/agent/constants/skills.ts)）：v1 全部在代码中定义（全局预置、非用户私有数据）；后续增删技能只改本文件。`id` 是存库的稳定 key（`conversations.active_skill_id`），改名不影响已持久化的会话。
- **当前 3 个技能**：`ecommerce-imagery`（电商套图设计专家）/ `xiaohongshu`（小红书图文专家）/ `general-creation`（通用创作专家）。电商与小红书为图文场景，均声明 7 工具白名单（禁用 `createVideoAsset` / `createVideoFromImageAsset`，防误烧视频成本）；通用不声明 tools（= 全量兜底）。
- **数据结构** `SkillRegistryEntry`：`{ id, name, description, instructions, placeholder?, tools?, examples? }`。`instructions` 是覆盖进 system 的专家人设 + 工作流；`placeholder` 是激活后输入框引导语；`tools` 是工具白名单（`AgentToolName[]`，**未声明 = 全量**，声明时必须覆盖工作流所需全部工具且与 instructions 提到的工具一致）；`examples` 是 few-shot 示范（`{ input, output }[]`，经 `renderExamples` 渲染为「示范」段落追加进 system，每技能 ≤2 条、单条精简控制 token）。
- **工具名常量** `AGENT_TOOL_NAMES` / `AgentToolName` 定义在 skills.ts（与 agent.ts 注册的工具 key 一一对应）：agent.ts → skills.ts 单向依赖，避免循环 import。新增工具时需同步追加到本常量；已声明 `tools` 的技能不会自动获得新工具（预期的能力边界，如需则显式加入对应技能的 tools）。
- **UI**（[`skill-selector.tsx`](../src/features/agent/components/chat/skill-selector.tsx)）：输入区一枚 pill（当前技能名或「通用」）+ 下拉列表（搜索 + 名称 + 何时用）。与模型选择器同构：选中即回调持久化（会话级）；激活后 pill 带 ✕ 一键清除回「通用」。工具集/示例不在 UI 展示。
- **持久化**：`conversations.activeSkillId` 列（text，可空）；`createConversation` / `updateConversation` 支持传入；`chat` 路由读会话的 `activeSkillId` 传入 `buildAgent`。
- **防御**：未知 / 已下架 id（`getSkill` → undefined）回退基础指令 + 全量工具，不报错（`isSkillId` 校验）；工具过滤只影响「模型能调什么」，不影响「历史消息能否被校验」（`agentValidationTools` 恒全量，见 §5）。

---

## 6. 资产化

- **五类资产**：`markdown` / `html` / `image` / `design` / `video`（元数据统一在 [`constants/kinds.ts`](../src/features/agent/constants/kinds.ts)，对话卡片 / 预览弹窗 / 表格列共用）。`design`（设计画布产物）由设计模块写入，见 [docs/design-editor.md](./design-editor.md)；`video`（视频产物）见 [docs/video-generation.md](./video-generation.md)。
- **文本资产**：正文直接存 `content` 列（Phase 1 决策：MVP 不引入 OSS，`storageKey` / `mime` / `sizeBytes` 字段已预留）。
- **图片 / 视频资产**：应用层预生成 `assetId` → 转存 OSS → 一次性 insert 全字段；`content` 列存生成 prompt（可溯源 / 可重试）。视频封面经 OSS 原生截帧（`videoSnapshotUrl`）动态生成，经 `/raw?snapshot=1` 同源代理下发（列表不渲染 `<video>`）。图片/设计的**缩略图**经 `/raw?thumb=1`（OSS 原生图片处理 `image/resize,w_320`，只等比缩放不裁切；处理不可用时回退原图）下发，避免 36~150px 格子拉 1~2MB 原图；仅 design 额外带 `&v=updatedAt` 破缓存（它的预览会被覆盖写，image 内容不可变），见 [docs/design-editor.md](./design-editor.md) 第 5 节。
- **血缘**：I2I 产物与 I2V 产物通过 `sourceAssetId` 指向源图；预览弹窗展示「基于《源标题》修改」；源图删除后 `SET NULL`，派生资产仍可访问。
- **收藏**（`favorite` boolean 列）：任意 kind 可收藏；列表支持「仅看收藏」筛选（`AssetFilters.favorite`）；切换走 `POST /api/agent/assets/[id]/favorite`（限流 60 次/分）。
- **下载**（[`assets/[id]/download`](../src/app/api/agent/assets/[id]/download/route.ts)）：有 `storageKey` → 302 跳转带附件名的短期签名 URL（TTL 300s）；文本资产直接返回 `content`；**无预览的 design**（`composeDesign` 首轮产出）返回 501（`content` 是文档 JSON，不能当 PNG 下发），前端相应隐藏下载入口。
- **删除**：删 DB 行的同时顺带删 OSS 对象（失败仅告警不阻塞）。
- **批量删除**（[`assets/batch-delete`](../src/app/api/agent/assets/batch-delete/route.ts)）：单次最多 100 个 uuid，逐个走 `deleteAsset`（含所有权校验与 OSS 清理）；不存在的 id 静默跳过，返回实际删除计数；全部未命中时 404。限流 10 次/分。
- **直连图片编辑**（[`assets/[id]/edit`](../src/app/api/agent/assets/[id]/edit/route.ts)）：图片资产行操作「继续修改」与设计画布「AI 修改」直连 I2I（不经聊天），核心流程与聊天内 `editImageAsset` 工具复用（[`image-edit.ts`](../src/features/agent/api/image-edit.ts) 的 `editImageAssetCore`）；产出派生资产（`sourceAssetId` 记录血缘），返回新资产 id。限流 20 次/分（I2I 是付费模型调用 ≈0.20 元/次）。
- **直连图片生成**（[`assets/generate`](../src/app/api/agent/assets/generate/route.ts)）：设计画布「AI 生成图片」直连 T2I（不经聊天），与聊天内 `createImageAsset` 工具同核（`generateImage` + `createImageAsset`）；产出 `conversationId=null`、`content=prompt`、`source='agent'` 的图片资产（title 缺省按 prompt 截断），返回新资产 id。限流 scope `image-generate` 20 次/分，`maxDuration=300`。

---

## 7. 模型注册表

模型注册表把 UI / DB 使用的**内部 key** 映射到底层 provider 与 model ID——未来模型改名 / 下线 / 换通道只需改一行配置，业务代码不动。

### 对话模型（[`constants/models.ts`](../src/features/agent/constants/models.ts)）

| key | label | providerModelId | 默认 |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek V4.1 Flash | `deepseek-v4.1-flash` | ✅ |
| `deepseek-v4-pro` | DeepSeek V4 Pro | `deepseek-v4-pro-0813` | |
| `qwen3.8-flash` | Qwen3.8 Flash | `qwen3.8-flash` | |
| `qwen3.8-max` | Qwen3.8 Max | `qwen3.8-max` | |

`resolveModel(key)`（[`provider.ts`](../src/features/agent/api/provider.ts)）优先经 `@ai-sdk/alibaba` 解析，不支持的模型回退到百炼 OpenAI 兼容模式（`createOpenAICompatible`），所有模型共用同一 `DASHSCOPE_API_KEY`。

### 图像模型（[`constants/image-models.ts`](../src/features/agent/constants/image-models.ts)）

| key | 说明 | 默认 |
| --- | --- | --- |
| `qwen-image-3.0` | 标准版：文字渲染稳定，兼顾质量与速度 | ✅ |
| `qwen-image-3.0-pro` | 旗舰：复杂版面 / 密集小字更强（较慢较贵）| |

比例预设 `ASPECT_PRESETS`（key → `"宽*高"`，全部 1K 计费档）：`1:1` / `3:4` / `4:3` / `3:2` / `2:3` / `16:9` / `9:16`。

### 视频模型（[`constants/video-models.ts`](../src/features/agent/constants/video-models.ts)）

| key | 说明 | 模式 | 默认 |
| --- | --- | --- | --- |
| `wan3.0-video` | 万相 3.0（官方推荐最新，原生音画同步，2-30s）| 统一 T2V+I2V | ✅ |
| `wan3.0-video-prime` | 万相 3.0 优速版（生成更快）| 统一 T2V+I2V | |
| `wan2.6-t2v` / `wan2.6-i2v-flash` | 万相 2.6（后备）| t2v / i2v | |

视频生成走 AI SDK v7 `experimental_generateVideo` + `@ai-sdk/alibaba` 的 `videoModel()`（provider 内置异步任务轮询），经**独立单例** `getAlibabaVideoProvider()` 配置国内 `videoBaseURL='https://dashscope.aliyuncs.com'`（默认指向 intl 新加坡，国内 key 必须覆盖）。完整架构与封面截帧机制见 [docs/video-generation.md](./video-generation.md)。

---

## 8. 图片生成通道

[`image-generation.ts`](../src/features/agent/api/image-generation.ts) 直连百炼 REST（不经 AI SDK provider——`@ai-sdk/alibaba` 无图像模型），不引入新依赖：

- 端点：`https://dashscope.aliyuncs.com` 的 `multimodal-generation/generation`（sync 协议）。
- T2I：`content = [{ text }]`；I2I：`content = [{ image: <公网URL> }, { text: <指令> }]`，源图用 OSS 短期签名 URL（TTL 900s）。
- **红线**：返回的图片链接 24h 有效，必须立即下载转存 OSS，任何持久化字段不得存临时 URL。
- 校验：PNG magic bytes、下载体积 ≤15MB；`enable_thinking` 显式关闭（否则耗时 3-4 倍）。
- 用户停止时 `abortSignal` 透传，同步取消进行中的请求与轮询。

---

## 9. API 端点一览

所有端点在开头 `auth()` 校验 userId；错误统一走 `apiError()` 信封。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/chat` | 发起生成，返回可恢复 SSE 流（`runtime=nodejs`，`maxDuration=300`）|
| GET | `/api/agent/chat/[id]/stream` | 重连进行中的流（`resume`）|
| POST | `/api/agent/chat/[id]/stop` | 停止生成（保存快照 + 写停止信号）|
| GET | `/api/agent/conversations` | 会话列表（含每会话资产数 `assetCounts`，供侧边栏 badge）|
| POST | `/api/agent/conversations` | 创建会话（可带 `activeSkillId` 激活技能）|
| PATCH / DELETE | `/api/agent/conversations/[id]` | 更新（标题 / 模型 / `activeSkillId`）/ 删除会话 |
| GET | `/api/agent/assets` | 资产列表（分页 / 搜索 / kind 筛选 / `favorite` 筛选 / 排序）|
| POST | `/api/agent/assets` | 创建 design 资产（限流 scope `design` 30/分）——详见 design-editor.md |
| GET / DELETE | `/api/agent/assets/[id]` | 资产详情（有 `storageKey` 时附签名 previewUrl，cover image + design）/ 删除 |
| PATCH | `/api/agent/assets/[id]` | 更新 design 资产（归属且 `kind==='design'`）|
| POST | `/api/agent/assets/[id]/favorite` | 收藏 / 取消收藏（任意 kind，限流 60/分）|
| POST | `/api/agent/assets/[id]/edit` | 直连图片编辑 I2I（不经聊天，限流 20/分，`maxDuration=300`）|
| POST | `/api/agent/assets/generate` | 直连图片生成 T2I（设计画布「AI 生成图片」，限流 scope `image-generate` 20/分，`maxDuration=300`）——详见 design-editor.md |
| GET | `/api/agent/assets/[id]/download` | 下载（image / design / video 有 `storageKey` 走 302 签名 URL，扩展名映射 video→mp4；文本直接返回）|
| GET | `/api/agent/assets/[id]/raw` | 资产字节同源代理（供设计画布加载图片规避 canvas 跨域污染；带 `?snapshot=1` 且 video 时回 OSS 截帧封面）|
| POST | `/api/agent/assets/batch-delete` | 批量删除（单次 ≤100 uuid，限流 10/分）|
| GET / POST | `/api/agent/knowledge/documents` | 知识库文档列表 / 新增（同步摄取，限流 scope `knowledge` 30/分）——见 knowledge-base.md |
| POST | `/api/agent/knowledge/documents/upload` | 上传文件新增文档（multipart；anydoc 解析 PDF/Office/Markdown 为结构化文本后同步摄取）——见 knowledge-base.md §4.1 |
| DELETE | `/api/agent/knowledge/documents/[id]` | 删除文档（片段级联删除）|
| POST | `/api/agent/knowledge/documents/[id]/retry` | 重新摄取（失败文档重试）|

---

## 10. 限流、计费与错误信封

### 错误信封（API 契约硬化 v1）

服务端可预期错误一律通过 [`apiError(status, code, message, headers?)`](../src/lib/api-error.ts) 返回 `{ error: { code, message } }`；`code` 取值：`unauthorized` / `invalid_json` / `invalid_request` / `not_found` / `payload_too_large` / `too_many_requests` / `insufficient_credits` / `generation_failed` / `not_implemented`。客户端 `api-client.ts` 的 `ApiError` 解析信封并暴露 `status` 与 `code`。

- **例外：`generation_failed`（502）的 `message` 为中文**——图片/视频生成失败原因（内容审核拒绝 / 上游限流 / 鉴权 / 参数 / 超时）已由 `GenerationError` 映射为用户可读文案，端点直接透传作为单一来源，客户端按 `code` 识别后原样展示（见 design 域的 `resolveAiImageError`）；其余 code 的 `message` 仍为简短英文。
- **路径参数**：所有 `[id]` 路由先用 [`isUuid`](../src/lib/utils.ts) 预校验，非法格式返回 404 `not_found`（避免直达 DB 产生 500）。
- **限流**：429 响应携带 `Retry-After` 头。

### 限流（固定窗口 Redis）

[`rate-limit.ts`](../src/features/agent/api/rate-limit.ts) 复用 Upstash Redis 计数；Redis 异常时 **fail-open**（放行并记录）：

| scope | 限额 | 窗口 | 说明 |
| --- | --- | --- | --- |
| `chat` | 20 次 | 60s / 用户 | 对话生成 |
| `stop` | 60 次（从宽，保证停止始终可用）| 60s / 用户 | 停止生成 |
| `design` | 30 次 | 60s / 用户 | 设计画布保存 |
| `knowledge` | 30 次 | 60s / 用户 | 知识库文档新增 |
| `favorite` | 60 次 | 60s / 用户 | 收藏切换（轻量 DB 写）|
| `image-edit` | 20 次 | 60s / 用户 | 直连 I2I（付费模型调用 ≈0.20 元/次）|
| `image-generate` | 20 次 | 60s / 用户 | 直连 T2I（设计画布 AI 生图，付费模型调用 ≈0.18 元/张）|
| `batch-delete` | 10 次 | 60s / 用户 | 批量删除（单次 ≤100 个）|
| `video` | 5 次 | 60s / 用户 | 视频生成（成本高于图片）——**在工具 `execute` 内校验**，命中抛中文错误由视频卡片展示（MVP 视频仅走流式 chat 路由，无法返回 HTTP 429）|

请求体上限 `MAX_REQUEST_BYTES = 4MB`（chat / stop / favorite / image-edit / image-generate / batch-delete 共用）；chat 另限 `MAX_MESSAGES=200`、`MAX_PARTS_PER_MESSAGE=500`。

### Credits 计费（402 余额不足）

所有付费 API 入口（对话 / 图片工具 / 整版设计工具（内含一次文生图）/ 直连图片生成与编辑 / 视频工具 / 知识库摄取）在发起上游调用前经 `checkBalance`（`balance > 0`）拦截，余额不足返回 **402 `insufficient_credits`**（工具入口抛中文错误由卡片展示）。扣费按真实 usage「发起后按结果扣」：对话在流 `onEnd` 按累计 token 结算（`usageSink` 经 `onStepEnd` 桥接）；图片/视频经 `chargeOnGenerationResult`（成功/abort/超时/下载失败照扣，鉴权/参数/限流/**内容审核拒绝**不扣）；知识库摄取按 embedding tokens。完整计费规则、定价与数据模型见 [docs/credits.md](./credits.md)。

---

## 11. 环境变量

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串；密码特殊字符需 URL 编码（`@`→`%40`）|
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（对话 / 图片 / 视频 / 嵌入模型共用）|
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 阿里云 OSS（私有 bucket；图片 / 视频等二进制资产，视频封面需桶开通视频截帧能力）|
| `REDIS_URL` | Redis 连接串（需 pub/sub 支持的 TLS 连接，推荐 Upstash）|

完整清单见 [`env.example.txt`](../env.example.txt)。

---

## 12. 本地开发与数据库迁移

```bash
# 由 schema.ts 生成迁移 SQL（无需连库）
bunx drizzle-kit generate

# 应用最新一个 .sql 到数据库（也可传入指定文件名）
bun scripts/db-apply-sql.ts
```

> 当前阿里云 RDS 实例下 `bun run db:push`（`drizzle-kit push`）会在连接阶段静默失败，因此采用确定性工作流：`drizzle-kit generate` 生成 SQL → `scripts/db-apply-sql.ts` 应用。`drizzle.config.ts` 已用 `process.loadEnvFile('.env.local')` 显式加载环境变量（drizzle-kit 不自动读取 `.env.local`）。数据库访问统一经 `getDb()` 懒加载，避免构建期缺 `DATABASE_URL` 失败。

### 冒烟脚本

`scripts/` 下保留可复跑的外部连通性 / 回归脚本：`models-smoke.ts`（对话模型）、`image-smoke.ts`（文生图）、`edit-smoke.ts`（图生图）、`video-smoke.ts`（文生视频 + OSS 截帧封面）、`oss-smoke.ts`（OSS 读写）、`resumable-smoke.ts`（流恢复）、`favorite-smoke.ts`（收藏）、`overview-smoke.ts`（总览统计）、`knowledge-smoke.ts`（知识库检索）、`db-apply-sql.ts`（应用迁移 SQL）。

> 真实外部调用测试须显式设置超时，否则默认超时中断会遗留测试数据。
