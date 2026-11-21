# Agent 创作模块

LV999 Dashboard 在后台骨架之上长出的核心业务模块：把「自然语言对话」转化为可沉淀、可管理的**内容资产**（Markdown / HTML / 图片 / 视频）。本文档描述其架构、数据模型、流式与停止机制、资产化设计、模型注册表与 API 契约。

> 该模块已接入**真实后端**（PostgreSQL + 阿里云 OSS + Redis + 阿里云百炼），非 Mock。运行前需配置对应环境变量（见文末）。
> 视频产物为 Phase 3 能力，架构与实现细节另见 [docs/video-generation.md](./video-generation.md)。

---

## 1. 概览

- **入口**：`/dashboard/agent`（新建会话）与 `/dashboard/agent/[conversationId]`（会话页）；产出在 `/dashboard/assets`（我的资产）统一管理。
- **编排**：AI SDK v7 `ToolLoopAgent`，每请求无状态构建，上下文经闭包注入工具。
- **工具**：`createAsset`（Markdown / HTML）、`editAsset`（文本资产精确编辑）、`createImageAsset`（文生图 T2I）、`editImageAsset`（图生图 I2I）、`createVideoAsset`（文生视频 T2V）、`createVideoFromImageAsset`（图生视频 I2V）、`composeDesign`（一句话生成整版设计）、`findAssets` / `readAsset`（资产复用）、`knowledgeSearch`（知识库语义检索）、`askUser`（澄清提问，客户端回答后自动续答）。
- **流式**：`resumable-stream` 可恢复 SSE，刷新 / 切回自动重连；停止走专用端点（跨实例真取消）。
- **持久化**：Drizzle ORM + PostgreSQL，三张表 `conversations` / `messages` / `assets`；图片 / 视频二进制存 OSS，库里只存 `storageKey`。
- **计费**：对话 / 生图 / 生视频 / 知识库摄取均在上游调用前原子预留 Credits，按实际结果结算；管理员可经 `/dashboard/admin/users` 发放 / 设定可用额度（仅 `ADMIN_USER_IDS` 白名单）；详见 [docs/credits.md](./credits.md)。

---

## 2. 架构与目录

```plaintext
src/features/agent/
├── api/
│   ├── types.ts            # 类型契约（Conversation / ChatMessage / Asset / 过滤参数）
│   ├── service.ts          # 数据访问层（服务端专用）：会话 / 消息 / 资产的 DB + OSS 操作
│   ├── queries.ts          # TanStack Query options + 查询键工厂 agentKeys
│   ├── mutations.ts        # 会话增删改的 mutation options
│   ├── provider.ts         # resolveModel(key)：百炼直连（@ai-sdk/alibaba）
│   ├── agent.ts            # buildAgent()、工具 execute 工厂、agentValidationTools 别名
│   ├── tool-contracts.ts   # 工具契约单一来源（description / inputSchema / outputSchema）+ InferUITools 推导的 UI 类型
│   ├── skill-service.ts    # 技能读取（skills 表，按用户隔离）与 CRUD
│   ├── image-generation.ts # 图片生成通道（直连百炼 REST，T2I / I2I）
│   ├── image-edit.ts       # 图生图核心流程（工具与直连端点复用）
│   ├── video-generation.ts # 视频生成通道（AI SDK experimental_generateVideo + 内置轮询，T2V / I2V）
│   ├── generation-error.ts # GenerationError（billable 计费分类）与错误链 haystack
│   ├── model-availability.ts # 模型下线 / 不存在识别（403 access_denied / 404）
│   ├── rate-limit.ts       # 固定窗口 Redis 限流
│   └── stop-signal.ts      # 跨实例停止信号（Redis 标志 + 轮询）
├── components/
│   ├── chat/               # 对话窗口、消息项、工具 part 卡片、模型选择器
│   ├── assets/             # 资产卡片、列表、预览弹窗、资产表格
│   └── conversations/      # 会话列表
├── constants/
│   ├── models.ts           # 对话模型注册表（4 个文本模型）
│   ├── image-models.ts     # 图像模型注册表（2 个）+ 比例预设 ASPECT_PRESETS
│   ├── video-models.ts     # 视频模型注册表（wan3.0-video 默认 + prime 优速）
│   ├── skills.ts           # 技能引擎（目录渲染 / 引用解析 / 工具边界计算）
│   ├── skill-templates.ts  # 「从模板新建」的表单预填（不进入运行时目录）
│   ├── kinds.ts            # 资产类型展示元数据（label / icon），卡片 / 表格共用
│   ├── asset-kinds.ts      # 资产类型枚举值（工具契约与消息类型共用，避免 contracts ↔ types 循环）
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

**分层约定**：客户端组件 → `queries.ts` / `mutations.ts`（经 `apiClient` 调 `/api/agent/*`）→ Route Handler → `service.ts`（服务端专用，项目约定不强制 `import 'server-only'`）→ DB / OSS。客户端**不直接**引用 `service.ts`。

---

## 3. 数据模型

Drizzle schema 定义于 [`src/lib/db/schema.ts`](../src/lib/db/schema.ts)，共三张表：

### conversations（会话）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | 默认随机生成 |
| `userId` | text | Better Auth user id |
| `title` | text | 会话标题（首条消息经 LLM 并行生成，失败回退截断；见 §4.8） |
| `model` | text | 会话级模型选择，默认 `deepseek-flash` |
| `activeStreamId` | text \| null | 正在进行的可恢复流 id；无活跃流时为 null |
| `createdAt` / `updatedAt` | timestamptz | |

> 技能不落会话列：每条用户消息的 `metadata.skillId` 记录本条显式指定的技能（见 §5.1）。

### messages（消息）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 与 AI SDK 消息 id 对齐 |
| `conversationId` | uuid FK → conversations | `ON DELETE CASCADE` |
| `role` | text | user / assistant 等 |
| `parts` | jsonb | 原样存储 AI SDK `UIMessage.parts` |
| `metadata` | jsonb \| null | assistant 含 `streamId`；user 含 `skillId` / `skillName`（本条显式指定技能） |
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
- 活跃流登记后若重连时 Redis 流尚未创建或无法恢复，重连端点返回 `stream_unavailable` 而不清除登记；用户可重新连接或显式停止。正常完成或停止时由生产者/停止端点清理登记。
- **必须提供 `generateMessageId`**：否则响应消息 id 为空串，会在 `messages` 主键上跨会话冲突（历史事故：串会话 + 消息丢失）。

### 4.2 新会话首条消息交接

新建会话时前端先 `createConversation` 拿到 id，再 `router.replace` 到会话页（**真实导航**，不能用 `history.replaceState`——否则 URL 与渲染树脱节、组件被复用、状态不重置）；首条消息经一次性交接由目标页发送。

### 4.3 停止信号（跨实例真取消）

见 [`stop-signal.ts`](../src/features/agent/api/stop-signal.ts) 与 [`chat/[id]/stop/route.ts`](../src/app/api/agent/chat/[id]/stop/route.ts)。serverless 多实例下无持久执行平台时的方案：

1. stop 端点保存客户端部分快照（`onConflictDoNothing`，只插不覆盖）。
2. 向 Redis 写入 `agent:stop:{conversationId}:{streamId}` 标志（TTL 300s）。
3. 生成路由每 2 秒轮询该标志，命中后 `abort` 底层生成（真取消）。
4. 校验后清理 `activeStreamId`（仅当仍指向同一流，避免误清之后启动的新流）。

客户端在发起请求前生成流 id，即使还未收到首个流消息也可请求停止。停止请求可先于生成路由登记流；生成路由在登记前和调用模型前检查已排队的停止信号，登记后的信号由轮询处理。登记使用比较并更新，较晚到达的旧请求不会覆盖其他页面已经启动的新流；竞争失败返回 `stream_changed`。客户端等待 stop 端点确认信号已登记，再断开本地流；这不是上游取消已完成的保证。请求失败或超时会提示生成可能仍在继续；消息快照超过请求体上限时，仅发送流 id 并提醒用户以服务端保存结果为准。停止已发起的付费任务仍可能产生费用，见 [credits.md](./credits.md)。

> **离开页面 / 卸载 ≠ 停止**：离开属于断开，应保持可恢复；只有点击停止按钮才真取消。

### 4.4 增量消息发送与持久化纪律

**增量协议（借鉴 chatbot 模板）**：客户端 `DefaultChatTransport.prepareSendMessagesRequest` 每次只发**最后一条消息**（新发送 / 重新生成 / 编辑皆然），历史以服务端 DB 为权威。路由在 claim 活跃流之后读取 `listMessages` 合并：增量消息 id **命中**历史 = 编辑/重新生成（替换目标消息并 `deleteTrailingMessages` 删除旧尾部）；**未命中** = 追加新消息。claim 后读历史保证 activeStreamId 已串行化并发生成，避免陈旧视图误删新轮次。合并后的完整历史经 `validateUIMessages` 校验（畸形历史 → 400 而非 500）再进模型。请求体不再随历史膨胀，4MB / 200 条限制仅约束单条消息与合并后总长。

`service.ts` 的 `syncConversationMessages` 采用「按所有权更新」：仅对本轮新产生的消息（`finalMessages` 超出 `originalMessages` 的尾部）执行冲突更新，其余旧消息一律 `onConflictDoNothing`，避免用陈旧视图覆盖服务端较新版本。`deleteTrailingMessages` 在新请求开始阶段删除目标消息之后的所有消息（被取代的失败/半截回答，或编辑点之后的旧内容）。

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
- **图片能力边界**：引用只传图片资产 id，不会把像素送给对话模型；`readAsset` 仅返回可能为空的生成提示词。图片仍可由图片编辑或图生视频工具使用，但模型不能据此声称看见或识别了图片；用户需用文字描述关键信息，或改用**图片附件**上传（§4.9，多模态模型可直接看到像素）。
- **解析**：[`parseAssetReferenceBlock`](../src/features/agent/lib/asset-reference.ts) 在气泡渲染与会话自动标题时剥离引用块只留用户原文（标题不应带机器可读块）。
- **标题归一**：标题内的换行 / 连续空白归一为单空格，避免破坏逐行解析。

### 4.6 消息操作栏（复制 / 重新生成）

assistant 消息底部 [`MessageFooter`](../src/components/ui/message.tsx) 操作栏（hover / 键盘聚焦淡入，触屏 `[@media(hover:none)]` 常显），承载两个高频动作：

- **复制**（[`copy-button.tsx`](../src/features/agent/components/copy-button.tsx)）：复制该消息所有 text part 的 **Markdown 源码**（`join('\n\n')`，非渲染态，粘走可再编辑）；✓ 态 1.5s + toast。[`clipboard.ts`](../src/features/agent/lib/clipboard.ts) `copyText` 主路径 `navigator.clipboard`（部署 https 可用）+ `execCommand` 兜底（权限拒绝 / 老浏览器），失败 toast 不静默。资产预览弹窗（markdown/html）复用同一 CopyButton 复制 `content`。
- **重新生成**（仅**最后一条** assistant 消息）：调 `useChat` 的 `regenerate()`（无参 = 末尾消息）；tooltip 明示「将再次消耗 Credits」（重roll = 新一轮模型调用）。**不对历史中间消息提供**——`regenerate(messageId)` 会截断其后所有对话。
- **流式禁用**：`isActive` 时两按钮禁用（内容未完整 / 防并发重roll）。
- **memo 纪律**：[`message-item.tsx`](../src/features/agent/components/chat/message-item.tsx) 是 memo 化的（Streamdown 解析贵）；操作栏新增 props 仅稳定回调（`onRegenerate` 为 chat-window 的 useCallback）+ 布尔（`isLastAssistant`），复制 ✓ 态自持 CopyButton 内部；**不传 `isGenerating`**（每轮生成翻转两次会击穿 memo、重渲染全部历史）——流式只发生在末尾，`isActive` 已等价覆盖禁用语义。

### 4.7 会话设置、列表与限制

- 新会话空态提供写内容、做图片、生成视频、设计封面四种示例；点击只填入输入框，不自动发送。资产库非空时另提供复用作品示例；空态从顶部显示，已有消息则保持末条消息锚点与自动滚动。空态另提供「按技能开始」入口：只选中技能（作用于下一条消息），不自动发送。
- 模型切换等待服务端保存后才更新显示，期间暂停发送；保存和读取各有 10 秒超时。保存失败时重新读取权威设置，无法读取时须手动重试同步。对话请求携带当前显示的模型，若与服务端不一致返回 `settings_changed`，客户端可同步后重试。
- 技能不写会话设置：输入区的选择只作用于**下一条消息**（消息 metadata.skillId），发送后自动清除；不选时由 Agent 按技能目录自动匹配（见 §5.1）。
- 侧边栏每次加载 50 个会话，按不可变的创建时间和 id 倒序游标分页，避免活跃会话更新时间改变时遗漏记录；界面注明排序方式。会话更新或生成结束仅刷新包含该会话的已加载页，新建和删除则刷新整个列表。
- 对话请求只含一条增量消息（单条 ≤500 个 part、请求体 ≤4 MB）；服务端合并后的历史最多 200 条消息。触及限制时可编辑失败消息，或将输入与资产引用带到新会话；后者通过客户端内存一次性交接，页面刷新会丢弃未交接草稿。

### 4.8 会话标题（LLM 并行生成）

首条用户消息且会话仍为默认标题（`新会话`）时，[`title-generation.ts`](../src/features/agent/api/title-generation.ts) 用默认廉价模型（`DEFAULT_MODEL`）`generateText` 生成 4-12 字语义标题（借鉴 chatbot 模板的 `generateTitleFromUserMessage` 模式）：

- **不阻塞主流**：标题 promise 与 Agent 生成并行；就绪后经外层 `createUIMessageStream` 写入 **transient** `data-conversation-title` part（不入消息 parts），客户端 `useChat` 的 `onData` 更新会话头部并失效会话列表缓存。
- **回退**：失败 / 超时（8s）回退 [`buildConversationTitle`](../src/features/agent/constants/conversation.ts) 的首条消息截断（先剥离 [引用资产] 块），保证标题始终可得。
- **落库守卫**：`applyGeneratedTitle` 条件 UPDATE 仅在标题仍为默认值时写入，避免覆盖用户手动改名。
- **计费**：标题 usage 计入对话 `UsageSink`，`onEnd` 结算前等待标题 promise（自带超时，通常先于主流完成），随本次 chat 一并扣费。

### 4.9 图片附件（多模态输入）

借鉴 chatbot 模板的附件模式，用户可上传图片让多模态模型**直接看到**图片内容（区别于 [引用资产] 只传 id）：

- **上传**：复用 `POST /api/agent/assets/upload`（multipart，PNG/JPEG/WebP ≤10MB，魔数校验），建 `source='upload'` 资产；输入区「图片」按钮 + 粘贴图片均可触发，单条消息 ≤4 张（`MAX_ATTACHMENTS_PER_MESSAGE`），上传中禁止发送。
- **能力门控**：附件按钮按模型注册表 `capabilities.multimodal` 禁用；切到非多模态模型时清空已选附件并提示。服务端兜底：非多模态模型移除全部 file part。
- **稳定 URL + 重签**：消息 file part 的 `url` 存同源代理路径 `/api/agent/assets/{id}/raw`（稳定不过期，浏览器带 cookie 显示，缩略图走 `?thumb=1`）；服务端调模型前经 [`attachment-urls.ts`](../src/features/agent/api/attachment-urls.ts) 按 assetId 归属校验后重签 OSS 签名 URL（TTL 900s，百炼公网拉取）。**只接受本代理路径模式，绝不信任任意外部 URL**；不可解析（已删除/越权）的附件移除并告警。历史附件每次请求重签，无过期问题。
- **渲染**：用户消息的图片 file part 渲染为缩略图（`message-item.tsx`）。
- **计费**：预留预算按历史 + 增量的 file part 总数每张加 4096 token 余量估算；实际以 usage 结算（多模态超出预留部分由平台承担，见 credits.md）。
- **能力边界**：附件让模型看到像素，但模型拿不到附件的 assetId（改图仍需用户经「引用资产」给出 id）；上传图已沉淀在「我的资产」，可随时引用。

### 4.10 思考过程展示（reasoning）

百炼对话模型默认思考：reasoning parts 由 AI SDK 随流下发（`toUIMessageStream` 默认 `sendReasoning`），本项目原样持久化在 `messages.parts`，其 token 已计入 `outputTokens` 计费。此前渲染层只处理 text 与已知 tool part，思考内容不可见；[`message-reasoning.tsx`](../src/features/agent/components/chat/message-reasoning.tsx) 把多个 reasoning part 合并为一个折叠块：

- 思考中自动展开并跟随滚动，结束后 1s 自动收起；显示累计思考时长。时长由服务端在 `messageMetadata` 中按 `reasoning-start` / `reasoning-end` 计时，下发 `reasoningDurations`（key = 该消息内 reasoning part 序号）并随消息 metadata 持久化——刷新 / 切回历史会话后仍显示「思考了 N 秒」；客户端本地计时仅在无持久化值时兜底（如中止未收到 reasoning-end）。续答轮复用同一 assistant 消息时，以已有 reasoning part 数作为索引偏移，避免覆盖上一段时长。
- 「思考中」仅当消息仍处于流式末尾且存在 `state === 'streaming'` 的 reasoning part——中止后 part 不落终态（AI SDK 中止语义），避免历史消息永久停在「思考中」。
- `submitted` 阶段（首个 chunk 到达前）在消息列表尾部显示「正在思考…」占位，覆盖思考模型的静默等待窗口。
- 不改变流协议与计费；时长经现有 `messageMetadata` 通道随消息 metadata 持久化（不新增 data part）。`MessageItem` 的 memo 纪律不受影响（展开/计时状态自持在折叠块内部，新增 props 仅为稳定原语）。

### 4.11 澄清提问（askUser，客户端工具）

`askUser` 是没有 `execute` 的客户端工具：模型调用后本轮流即结束（part 停留 `input-available`），由消息滚动区底部的 `QuestionCard`（`@shadcn/react/questionnaire`）收集回答；回答经 `useChat.addToolOutput` 回写 tool output，客户端 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` 随即自动续答。

- **增量协议扩展**：续答请求发送的最后一条消息是 **assistant**（带 tool output），而非 user。路由在 claim 后读取历史并校验：该消息必须是最新一条、且含与历史中待回答 `askUser` 同 `toolCallId`、`state === 'output-available'` 的 part，否则 400；其余历史仍以 DB 为权威。该谓词只在 `addToolOutput` 后评估，普通服务端工具回合不会触发自动续答。
- **持久化 / 刷新**：问题与回答随 `messages.parts` 落库。刷新后待回答的提问重新弹出卡片；已回答的提问渲染为「已确认 N 个创作细节」折叠行（[`ask-user-part.tsx`](../src/features/agent/components/chat/ask-user-part.tsx)）。
- **计费**：提问轮与续答轮各是一次普通对话请求，按 usage 结算；续答余额不足时返回 402，可用错误条上的「编辑输入」回到原始请求重新发送。
- **停止 / 恢复**：提问流结束后无活跃流；续答是新的可恢复流，停止 / 重连语义与普通回合一致。
- **防滥用**：系统指令限制「一次对话最多提问一轮、能从上下文推断时不提问」；`askUser` 不受技能工具边界过滤（技能加载后也可先问清需求）。

---

## 5. Agent 与工具

`buildAgent()`（[`agent.ts`](../src/features/agent/api/agent.ts)）每请求构建一个 `ToolLoopAgent`：`stopWhen: isStepCount(6)`、`timeout.totalMs: 295_000`（需 ≥ 视频轮询上限 280s + 转存/落库，仍 < 路由 `maxDuration=300`）、`onStepEnd` / `onEnd` 记录 step / usage。工具：

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| `createAsset` | `title` / `kind`(markdown\|html) / `content` | 文本作品直接落库 `assets.content`；`≤200KB`（`MAX_ASSET_SIZE_BYTES`）|
| `editAsset` | `assetId` / `old_string` / `new_string` / `replace_all?` / `title?` | 文本资产（markdown/html）精确局部编辑：原文替换保持 `assetId` 不变（借鉴 Claude Code edit 模式，小改优先、整篇重写才用 createAsset）。`old_string` 须逐字命中且默认唯一（多处命中需 `replace_all=true`）；替换用函数 replacer 防 `$&` 注入；编辑后仍 `≤200KB`；纯 DB 写不计费 |
| `createImageAsset` | `title` / `prompt` / `aspect?` | 文生图：工具内限流（`image-generate` scope，20/分，与直连端点共用）→ 生成 → 立即下载 → 转存 OSS → 入库图片资产 |
| `editImageAsset` | `sourceAssetId` / `title` / `instruction` / `aspect?` | 图生图（I2I）：工具内限流（`image-edit` scope，20/分）→ 校验源图归属/kind/`storageKey`/≤10MB → 签名 URL 直传百炼 → 产出派生资产（`sourceAssetId` 记录血缘）|
| `createVideoAsset` | `title` / `prompt` / `aspect?` / `duration?(2..10)` | 文生视频（T2V）：工具内限流（video scope）→ `experimental_generateVideo`（内置轮询）→ 下载 → 转存 OSS → 入库视频资产；详见 [docs/video-generation.md](./video-generation.md) |
| `createVideoFromImageAsset` | `sourceAssetId` / `title` / `prompt` / `aspect?` / `duration?` | 图生视频（I2V）：限流 → 校验源图（归属/`kind='image'`/`storageKey`/≤10MB）→ 签名 URL（TTL 900s）作首帧 → I2V → 入库（`sourceAssetId` 血缘）|
| `findAssets` | `query?` / `kind?` / `limit?` | 按标题关键词 + 类型检索用户资产库，返回候选元信息（不含正文/URL）——按【标题】找「作品」供复用/改写 |
| `readAsset` | `assetId` | 读取资产内容：markdown/html 返回正文、image/video 返回生成 prompt（design 不支持），供“基于它再创作” |
| `knowledgeSearch` | `query` / `topK?` | 在 RAG 知识库中按【语义】检索「资料」片段（问答/综述），返回 topK 片段 + 来源标题；见 [docs/knowledge-base.md](./knowledge-base.md) |
| `composeDesign` | `title` / `imagePrompt` / `heading?` / `subheading?` / `layout`(top-image\|full-image-bar\|left-image) / `aspect?` | **一句话生成整版设计**：工具内限流（`image-generate`）→ `checkBalance` → 文生图（计费 image 档，比例按**版式主图区域**选最接近的一档）→ `createImageAsset`（主图仍沉淀为独立资产）→ `sharp` 读自然尺寸 → [`design/lib/layouts.ts`](../src/features/design/lib/layouts.ts) 按版式组装文档（坐标/字号/对齐全由代码计算）+ sanitize → `createDesignAsset(previewPng=null)`；返回 `{ assetId, title, kind:'design', sizeBytes, imageAssetId }`，对话内渲染「打开编辑」卡片。design 落库为纯 JSON 组装，**不额外计费**；无预览（预览由画布保存时客户端导出补上）。详见 [docs/design-editor.md](./design-editor.md) |
| `loadSkill` | `name`（必须与目录名称一致） | **按需加载技能**：system 只常驻技能目录（名称 + 何时用），模型判断任务匹配后调用本工具拿到完整正文（tool result 进入历史）；`prepareStep` 在加载后按技能 `tools` 收窄后续步骤的 `activeTools`（本次回复内生效） |
| `askUser` | `questions[{ question, choices[2..4] }]`（1-3 个问题） | 客户端工具（无 `execute`）：向用户弹选项卡澄清关键创作参数，本轮流在此停住；回答后经 tool output 自动续答。不受技能工具边界过滤（见 §4.11） |

> 区分：`findAssets` 按标题找「作品」（复用/改写/改图）；`knowledgeSearch` 按语义找「资料」（基于内容作答并标注来源）。对话中的 `[引用资产]` 块给出的 id 可直接使用，无需再检索。

**工具契约（[`tool-contracts.ts`](../src/features/agent/api/tool-contracts.ts)）**：description / inputSchema / outputSchema 的唯一来源。`agentValidationTools` 直接复用全量契约，`agent.ts` 的工厂只从契约取 schema 并挂 `execute`，避免同一工具各写一遍导致漂移。`AgentChatMessage` 经 `InferUITools<typeof agentToolContracts>` 推导工具 part 的 input / output，渲染层不再手写 `ToolPart` 接口或双重断言——工具字段改名会直接成为编译错误。`outputSchema` 同时让 `validateUIMessages` 校验历史 tool output（结构漂移在请求入口 400，而非 UI 读到 `undefined`）；新增 / 修改工具输出时必须同步更新对应 outputSchema，并覆盖所有分支（如 `readAsset` 的四种返回）。

工具校验用 `agentValidationTools`（即全量工具契约，**恒为全量 12 工具（10 业务 + loadSkill + askUser）、不随技能过滤**），配合 `validateUIMessages` 对历史消息做进入模型前的校验（畸形历史 → 400 而非 500）。`buildAgent.tools` 则按当前技能的工具边界过滤注册（见 §5.1）——两者必须分离：历史消息可能含任意技能的工具调用，若校验工具也过滤会导致历史校验 400。`askUser` 例外：它恒被注册（工具边界只约束业务工具）。

### 5.1 技能系统（按需加载的专家工作流包）

技能 = 可被模型发现、**按需加载**的工作流/风格包，不是「会话模式」。system 只常驻轻量目录（名称 + 何时用），模型判断任务匹配后调用 `loadSkill` 读取完整正文；用户也可以对**某一条消息**显式指定技能。技能数据**只来源于 `skills` 表**（按 `userId` 隔离）；代码内示例只作为「模板」服务「从模板新建」的表单预填，不进入运行时目录（见 `constants/skill-templates.ts`）。

- **数据结构** `SkillRegistryEntry`（[`constants/skills.ts`](../src/features/agent/constants/skills.ts)）：`{ id, name, description, instructions, placeholder?, tools?, examples? }`。`instructions` 是技能完整正文（专家人设 + 工作流），按需加载；`placeholder` 是选中后输入框引导语；`tools` 是工具边界（`AgentToolName[]`，**未声明 / null = 全量；非 null 时至少 1 个，空数组由 schema 拒绝**，加载后本次回复内生效）；`examples` 是 few-shot 示范（`{ input, output }[]`，随正文经 `renderSkillBody` 按需返回，每技能 ≤2 条）。服务端 `listSkillEntriesForUser` 把 DB 行映射为该结构，零重复复用目录 / 加载 / 工具边界逻辑。
- **两条入口**：
  1. **自动**：`buildAgent` 把轻量目录（名称 + description，最多 `MAX_CATALOG_SKILLS=16` 个）拼进 system；无技能时不渲染目录、也不注册 `loadSkill`。模型调用 `loadSkill({ name })`，正文与稳定 `id` 以 tool result 进入消息历史；`prepareStep` 在加载后按技能 `tools` **取交集**收窄后续步骤的 `activeTools`（每步重新计算；未声明 tools = 全量，不额外放宽）。
  2. **显式**：用户消息 `metadata: { skillId, skillName }`（`sendMessage` 的 metadata，随消息持久化）。chat 路由从 `listSkillEntriesForUser` 中按 id 解析（归属过滤），直接注入正文并从第一步限制工具；**不注册 `loadSkill`**，避免模型再加载另一个技能绕过用户选定的边界。找不到 → 400 `unknown_skill`。askUser 续答时从上一轮 `tool-loadSkill` 的 `output.id` 回灌已加载技能（缺 id 时按名称兜底），自定义技能改名不影响边界恢复。
- **技能模板** `SKILL_TEMPLATES`（[`constants/skill-templates.ts`](../src/features/agent/constants/skill-templates.ts)）：只服务管理页「从模板新建」的表单预填（当前 2 个：电商套图设计专家 / 小红书图文专家），不落库、不进入自动路由、不参与工具边界；点「从模板新建」后按普通技能入库，可改可删。模板内容只写基座指令表达不出来的领域知识（平台惯例 / 广告法 / 封面策略），与 `AGENT_INSTRUCTIONS` 和工具 description 不重复，避免工具演进后模板正文漂移。
- **自定义技能表** `skills`（[`schema.ts`](../src/lib/db/schema.ts)）：用户私有（`userId` 隔离），列 `name / description / instructions / placeholder? / tools(jsonb) / examples(jsonb) / createdAt / updatedAt`，`id` 为 uuid。`tools` 为 null = 全量；非 null 时至少 1 个。
- **名称唯一**：`loadSkill` 先按 id、再按 name 查找；`createSkill` / `updateSkill` 校验当前用户内名称唯一（trim + 大小写不敏感，`SkillNameConflictError` → 409 `skill_name_conflict`），避免加载到不可预期的技能。
- **工具名常量** `AGENT_TOOL_NAMES` / `AgentToolName` 定义在 skills.ts（与 agent.ts 注册的工具 key 一一对应）：agent.ts → skills.ts 单向依赖，避免循环 import。新增工具时需同步追加到本常量与中文名表 `AGENT_TOOL_LABELS`；已声明 `tools` 的技能不会自动获得新工具（预期的能力边界）。
- **读取分档**（[`skill-service.ts`](../src/features/agent/api/skill-service.ts)，服务端专用）：`listSkillEntriesForUser`（完整条目，服务端目录 / loadSkill / 显式技能校验）、`listSkillCatalogForUser`（轻量目录，客户端选择器 / 空态）、`listSkillDetailsForUser`（完整内容，管理页），三者均按 `userId` 过滤、按创建时间倒序。**`buildAgent` 保持纯函数不碰 DB**：入参为已解析的 `skills: SkillRegistryEntry[]` + `forcedSkill?: SkillRegistryEntry | null` + `preloadedSkillIds?: readonly string[]`，由 chat 路由一次查询后传入。
- **CRUD 端点**（`/api/agent/skills*`，归属即权限、限流 scope `skills` 30/分、纯管理不计费）：`GET /api/agent/skills`（轻量目录 `{ skills }`，选择器/空态用）/ `GET /api/agent/skills?include=body`（完整内容，管理页用）/ `POST`（创建，Zod 校验 + 名称唯一 → `{ id }`）/ `PATCH /api/agent/skills/[id]`（更新，**仅 uuid + 归属**）/ `DELETE /api/agent/skills/[id]`（删除；历史消息里的技能引用保留，界面按名称展示）。校验：`name 1..50` / `description 1..200` / `instructions 1..8000` / `placeholder ≤100?` / `tools ⊆ AGENT_TOOL_NAMES 且非空?` / `examples ≤2 { input 1..300, output 1..500 }`；服务端返回通用英文信封，中文提示由客户端表单校验（同一 `skillMutationSchema`）给出。
- **UI**：输入区 [`skill-picker.tsx`](../src/features/agent/components/chat/skill-picker.tsx)（`SkillPicker`）为「下一条消息」选择技能，选中后输入框出现技能 chip，发送后由 chat-window 清空；不选 = 自动匹配。空态在存在技能时提供「按技能开始」入口（技能全部来自自建，零技能时不展示 chips）。消息流：用户消息按 metadata 显示技能 chip；assistant 的 `tool-loadSkill` 渲染为「已加载技能：X」。管理页 `/dashboard/skills`（[`components/skills/`](../src/features/agent/components/skills/)）= 列表（全部为用户自建，可编辑 / 删除）+ 头部「新建技能」与「从模板新建」+ 编辑对话框（名称 / 描述 / 工作流正文 + 撰写提示 / 引导语 / 工具边界 / 0-2 组示例）；无技能时列表给出模板入口提示。
- **防御**：显式技能 id 非法 / 越权 / 已删除 → 400 `unknown_skill`（客户端提示重选）；自动加载名称未命中 → 工具报错让模型回到目录重选；`agentValidationTools` 恒为全量（含 `loadSkill`），历史消息仍可被校验。已加载技能在续答前被删除 / id 无法解析时，该技能不参与边界计算（降级为全量），与显式技能删除时的降级一致。
- **编写规范与兼容性**（对齐 Agent Skills 开放格式）：
  - `id` 是技能 uuid（DB 生成），也是历史消息 / 续答回灌的解析依据；改名不影响已持久化的引用。
  - `name` 是展示名，同一用户内唯一（loadSkill 先按 id、再按名称解析，同名会让模型加载到不可预期的技能）。
  - `description` 是唯一路由信号：写清「做什么 + 何时用 + 不用于什么」，建议包含触发关键词；限 200 字。
  - `instructions` 是加载后整段进入上下文的正文：建议 <500 行 / <5000 tokens（硬上限 8000 字），过长请精简或拆技能。
  - `examples` ≤2 条，随正文按需返回。
  - `tools` 是成本/能力提示，不是安全边界；多个技能同时加载取交集，真正的兜底是 Credits + 工具级限流。
  - 一次回复尽量只加载一个技能；多技能工具边界取交集，可能裁掉必需工具；交集为空时先澄清或换技能。
  - 目录上限 `MAX_CATALOG_SKILLS=16`，超出部分不参与自动路由（选择器仍可见）。
  - 允许并鼓励把常用套路先写成「模板」再一键新建：模板不进入运行时目录，避免示例被自动路由、也避免与基座指令重复后漂移。
  - `bun run skills:check` 校验引用解析 / 目录渲染上限 / 工具边界交集 / mutation schema / 模板可一键新建（纯静态，不依赖 DB）。
  - 不采用 provider 级 `uploadSkill`：百炼不支持 SkillsV4，且会把执行权交给 provider、绕开 Credits 与工具边界。

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
| `deepseek-v4-pro` | DeepSeek V4 Pro | `deepseek-v4-pro` | |
| `qwen3.8-flash` | Qwen3.8 Flash | `qwen3.8-flash` | |
| `qwen3.8-max` | Qwen3.8 Max | `qwen3.8-max` | |

`resolveModel(key)`（[`provider.ts`](../src/features/agent/api/provider.ts)）统一经 `@ai-sdk/alibaba` 对话通道解析，所有模型共用同一 `DASHSCOPE_API_KEY`。

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

视频生成走 AI SDK v7 `experimental_generateVideo` + `@ai-sdk/alibaba` 的 `videoModel()`（provider 内置异步任务轮询），经**独立单例** `getAlibabaVideoProvider()` 配置国内 `videoBaseURL='https://dashscope.aliyuncs.com'`（默认指向 intl 新加坡，国内 key 必须覆盖）。完整架构与封面截帧机制见 [docs/video-generation.md](./video-generation.md)。

### 模型下线与可用性自查

百炼会按迭代不定期下线老旧模型：**主线模型提前 3 个月、带日期的快照模型仅提前 30 天**通知（[官方下线机制](https://help.aliyun.com/zh/model-studio/model-depreciation)）。由此定下两条约定：

- **注册表优先用主线名**，不用快照名（例：`deepseek-v4-pro` 而不是 `deepseek-v4-pro-0813`）——下线通知窗口相差 3 倍。
- **收到下线公告就跑一次** `bun run scripts/model-audit.ts`（对话 + embedding，成本约几分钱）；覆盖图片 / 视频加 `--image` / `--video` / `--all`。退出码非 0 即有模型不可用，输出会直接给出要改哪个注册表文件。

已下线（或账号未开通）的模型调用返回 **403 + `access_denied`**，报错文案不含「已下线」字样；模型名不存在返回 **404**。[`api/model-availability.ts`](../src/features/agent/api/model-availability.ts) 的 `detectModelUnavailable()` 把这两类从「鉴权失败」里摘出来，输出可操作中文（`MODEL_RETIRED_MESSAGE` / `MODEL_NOT_FOUND_MESSAGE`，服务端与客户端共用同一常量）并统一打 `[agent] model unavailable` 日志——**可按该前缀配 403 告警**，否则批量退役在监控里表现为一堆看似无关的权限异常。反向误报同样要防：`AllocationQuota.FreeTierOnly`（免费额度耗尽）、`Workspace.AccessDenied`（子空间无权限）、`isv.OUTOFSERVICE`/`Arrearage`（停服/欠费）与 Key 失效均**不**进该日志（换模型无用），仍走原有鉴权/欠费/配额提示——保证该告警信号不被日常错误污染。三个接入点：对话（`chat/route.ts` 的 `toUIMessageStream({ onError })` → `chat-window.tsx` 原样透传）、图片（`image-generation.ts`）、视频（`video-generation.ts`）；均属于上游明确失败 → `billable: false`，不扣 credits。

---

## 8. 图片生成通道

[`image-generation.ts`](../src/features/agent/api/image-generation.ts) 直连百炼 REST（不经 AI SDK provider——`@ai-sdk/alibaba` 无图像模型），不引入新依赖：

- 端点：`https://dashscope.aliyuncs.com` 的 `multimodal-generation/generation`（sync 协议）。
- T2I：`content = [{ text }]`；I2I：`content = [{ image: <公网URL> }, { text: <指令> }]`，源图用 OSS 短期签名 URL（TTL 900s）。
- **红线**：返回的图片链接 24h 有效，必须立即下载转存 OSS，任何持久化字段不得存临时 URL。
- 校验：图片 magic bytes（png/jpeg/webp，mime 与 OSS 扩展名均按真实类型落库）、下载体积 ≤15MB；`enable_thinking` 显式关闭（否则耗时 3-4 倍）。
- 用户停止时 `abortSignal` 透传，同步取消进行中的请求与轮询。
- 计费分类：生成调用不自动重试（按张计费，重试有双计费风险）；`create-task` 阶段的网络/非 JSON 失败不扣；`query-task` / `sync` 阶段已送达后的网络中断、超时、下载失败照扣，DNS 解析失败 / 连接被拒 / 证书错误等未建连失败不扣（见 [docs/credits.md](./credits.md)）。

---

## 9. API 端点一览

所有端点在开头经 DAL 的 `getUserId()` 校验 userId（未登录 401）；错误统一走 `apiError()` 信封。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/chat` | 发起生成，返回可恢复 SSE 流（`runtime=nodejs`，`maxDuration=300`）|
| GET | `/api/agent/chat/[id]/stream` | 重连进行中的流（`resume`）|
| POST | `/api/agent/chat/[id]/stop` | 停止生成（保存快照 + 写停止信号）|
| GET | `/api/agent/conversations?cursor=...` | 会话列表（按创建时间倒序游标分页，每页 50 条；返回 `conversations` / `nextCursor`，首次省略 cursor，无下一页时为 null）|
| POST | `/api/agent/conversations` | 创建会话（标题/模型；技能随消息 metadata 指定，见 §5.1）|
| PATCH / DELETE | `/api/agent/conversations/[id]` | 更新（标题 / 模型）/ 删除会话 |
| GET | `/api/agent/assets` | 资产列表（分页 / 搜索 / kind 筛选 / `favorite` 筛选 / 排序）|
| POST | `/api/agent/assets` | 创建 design 资产（限流 scope `design` 30/分）——详见 design-editor.md |
| POST | `/api/agent/assets/upload` | 本地图片上传（multipart；魔数校验 PNG/JPEG/WebP ≤10MB → OSS + `source='upload'` 资产；限流 30/分，不计费）——聊天附件与设计画布共用 |
| GET / DELETE | `/api/agent/assets/[id]` | 资产详情（有 `storageKey` 时附 3600s 签名 previewUrl，覆盖 image / video / design 预览；design 无预览 PNG 时为 null）/ 删除 |
| PATCH | `/api/agent/assets/[id]` | 更新 design 资产（归属且 `kind==='design'`）|
| POST | `/api/agent/assets/[id]/favorite` | 收藏 / 取消收藏（任意 kind，限流 60/分）|
| POST | `/api/agent/assets/[id]/edit` | 直连图片编辑 I2I（不经聊天，限流 20/分，`maxDuration=300`）|
| POST | `/api/agent/assets/generate` | 直连图片生成 T2I（设计画布「AI 生成图片」，限流 scope `image-generate` 20/分，`maxDuration=300`）——详见 design-editor.md |
| GET | `/api/agent/assets/[id]/download` | 下载（image / design / video 有 `storageKey` 走 302 签名 URL，扩展名按 kind/mime 映射：image→png/jpg/webp、design→png、video→mp4；文本直接返回）|
| GET | `/api/agent/assets/[id]/raw` | 资产字节同源代理（供设计画布加载图片规避 canvas 跨域污染；带 `?snapshot=1` 且 video 时回 OSS 截帧封面）|
| POST | `/api/agent/assets/batch-delete` | 批量删除（单次 ≤100 uuid，限流 10/分）|
| GET / POST | `/api/agent/knowledge/documents` | 知识库文档列表 / 新增（同步摄取，限流 scope `knowledge` 30/分）——见 knowledge-base.md |
| POST | `/api/agent/knowledge/documents/upload` | 上传文件新增文档（multipart；anydoc 解析 PDF/Office/Markdown 为结构化文本后同步摄取）——见 knowledge-base.md §4.1 |
| DELETE | `/api/agent/knowledge/documents/[id]` | 删除文档（片段级联删除）|
| POST | `/api/agent/knowledge/documents/[id]/retry` | 重新摄取（失败文档重试）|
| GET | `/api/agent/knowledge/documents/[id]` | 文档详情（**预览用**：元信息 + 入库原文 + 片段列表，不 select embedding）——见 knowledge-base.md §7 |
| POST | `/api/agent/knowledge/search` | **检索测试**（复用 `searchKnowledgeByText` 同链路同阈值；零计费；限流 scope `knowledge` 30/分）——见 knowledge-base.md §5 |

---

## 10. 限流、计费与错误信封

### 错误信封（API 契约硬化 v1）

服务端可预期错误一律通过 [`apiError(status, code, message, headers?)`](../src/lib/api-error.ts) 返回 `{ error: { code, message } }`；`code` 取值：`unauthorized` / `forbidden` / `invalid_json` / `invalid_request` / `not_found` / `payload_too_large` / `settings_changed` / `stream_changed` / `stream_unavailable` / `unknown_skill` / `skill_name_conflict` / `too_many_requests` / `insufficient_credits` / `generation_failed` / `not_implemented`。客户端 `api-client.ts` 的 `ApiError` 解析信封并暴露 `status` 与 `code`。

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

请求体上限 `MAX_REQUEST_BYTES = 4MB`（chat / stop / favorite / image-edit / image-generate / batch-delete / design 创建与更新 / 知识库 documents POST 共用）；chat 另限合并后历史 `MAX_MESSAGES=200`、单条 `MAX_PARTS_PER_MESSAGE=500`、单条图片附件 ≤4（`MAX_ATTACHMENTS_PER_MESSAGE`）。

### Credits 计费（402 余额不足）

所有付费 API 入口（对话 / 图片工具 / 整版设计主图 / 直连图片生成与编辑 / 视频工具 / 知识库摄取）在发起上游调用前原子预留可用 Credits；余额不足返回 **402 `insufficient_credits`**（工具入口抛中文错误由卡片展示）。对话在流 `onEnd` 按已完成步骤的 token usage 结算，图片/视频经 `chargeOnGenerationResult` 按结果结算，知识库摄取成功后按 embedding tokens 结算。结算最多扣除预留额度，超额由平台承担并记录；异常中断后的冻结需人工对账。完整规则、限制和部署步骤见 [docs/credits.md](./credits.md)。

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
# 由 schema 生成增量迁移 SQL（无需连库）
bun run db:generate

# 应用到 DATABASE_URL（已应用状态记录在 drizzle.__drizzle_migrations，重复执行安全）
bun run db:migrate

# 校验迁移链快照（手动排查用：只发现快照损坏 / 冲突，版本不匹配与缺文件仍会放过）
bun run db:check
```

> 迁移链是「单基线 + 增量」：`0000_baseline.sql` 由 `schema.ts` + `auth-schema.ts` 生成（文件头手动补了 `CREATE EXTENSION IF NOT EXISTS vector`，因为 drizzle-kit 不生成扩展语句），`0001_knowledge_hnsw.sql` 是 `--custom` 手写迁移，用于补 pgvector 的 HNSW 索引（drizzle-kit 不生成）。因此**空库可直接 `bun run db:migrate` 建好**，不依赖任何外部 dump；已应用状态由 drizzle-kit 记录，重复执行只跑未应用的迁移，不再需要人工记忆。阿里云 RDS 实例下 `drizzle-kit push` 会在连接阶段静默失败，项目不提供 `db:push`，统一走迁移链。已有数据但尚无记录的旧库用 `bun run db:stamp`（默认 dry-run）接入。`drizzle.config.ts` 已用 `process.loadEnvFile('.env.local')` 显式加载环境变量（drizzle-kit 不自动读取 `.env.local`）。数据库访问统一经 `getDb()` 懒加载，避免构建期缺 `DATABASE_URL` 失败。

### 冒烟脚本

`scripts/` 下保留可复跑的外部连通性 / 回归脚本：`models-smoke.ts`（对话模型）、`skills-smoke.ts`（技能契约检查：引用解析 / 目录渲染上限 / 工具边界 / schema / 模板可一键新建）、`model-audit.ts`（全通道可用性自查与「模型已下线」识别，见 §7）、`image-smoke.ts`（文生图）、`edit-smoke.ts`（图生图）、`video-smoke.ts`（文生视频 + OSS 截帧封面）、`oss-smoke.ts`（OSS 读写）、`resumable-smoke.ts`（流恢复）、`favorite-smoke.ts`（收藏）、`overview-smoke.ts`（总览统计）、`knowledge-smoke.ts`（知识库检索）、`knowledge-file-smoke.ts`（知识库文件解析 / 上传）、`credit-smoke.ts`（Credits 发放 / 预留 / 结算）、`credit-admin.ts`（Credits 管理 CLI，见 [docs/credits.md](./credits.md)）、`db-stamp.ts`（为已有库补写迁移记录）。

> 真实外部调用测试须显式设置超时，否则默认超时中断会遗留测试数据。
