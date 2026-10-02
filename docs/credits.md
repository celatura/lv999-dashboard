# Credits 消耗系统

LV999 Dashboard 的**成本管控底座**：Agent 的对话 / 生图 / 生视频 / 知识库摄取背后调用的是**部署者提供的百炼 API Key**，每次调用产生真实费用。本系统按 **Credits（积分）** 扣费、余额不足即拒绝，杜绝开源场景下「陌生人刷爆作者 API」的成本风险。

> **核心取向**：公开注册保持开放，但新用户默认 **0 积分**、无体验额度；计费入口的 `checkBalance` 对 0 余额直接拒绝（HTTP 402）。成本上界钉死为 **0**（注册零成本，除非管理员 `grant`）。方案以**极简**为第一原则：无预扣、无冻结、无有效期、无支付、无退款。术语统一 **Credits**（UI 文案用 Credits）。**零新增 npm 依赖、零新增环境变量**（复用 `DATABASE_URL`）。

---

## 1. 概览

- **计费入口**（发起上游调用前 `checkBalance`，`balance > 0` 放行，否则 402）：对话 `chat`、图片（工具 + 整版设计工具 + 直连生成/编辑端点）、视频（T2V/I2V 工具）、知识库摄取（新增/上传/重试）。
- **扣费时机**：按真实 usage「**发起后按结果扣**」——对话在流 `onEnd` 按累计 token 结算；图片/视频在上游调用返回后按结果判定；知识库在摄取成功后按 embedding tokens 结算。
- **计量**：后端按 token / 张 / 秒精算，前端只展示余额与流水，不暴露档位估算。
- **余额展示**（不常驻）：账号下拉菜单显示余额 + `/dashboard/profile/credits` 看流水。
- **发放**：管理员经**用户管理后台** `/dashboard/admin/users`（`ADMIN_USER_IDS` 白名单 + 服务端 `isAdmin` 校验，复用 `grantCredits`/`setBalance`）；CLI `scripts/credit-admin.ts` 保留为应急后备（能访问 `DATABASE_URL` 即视为管理员）。
- **管理员同走积分**：无 `unlimited` 特权，只是多一个「能给自己/他人加分」的管理动作。

---

## 2. 数据模型（`src/lib/db/schema.ts` 两表，迁移 `0005`）

**`credits_accounts`**（余额，每用户一行，懒创建）：`userId`(text PK) / `balance`(integer notNull default 0，**可为负**——单次透支) / `createdAt` / `updatedAt`。

**`credit_ledger`**（流水，只增不改，审计 + 前端展示）：`id`(uuid PK) / `userId`(text) / `delta`(integer，正=grant 负=消耗) / `balanceAfter`(integer，本笔后余额快照，免回算) / `kind`(text：`grant`/`chat`/`image`/`video`/`knowledge`) / `meta`(jsonb，计量明细) / `createdAt`。索引 `(userId, createdAt)`。

- **懒创建**：无账户行视为 `balance=0`；`chargeCredits`/`grantCredits` 对无行 user 先 upsert 建行。新注册用户天然 0 余额被拦，**不依赖任何认证方 webhook**。
- **迁移**：`bunx drizzle-kit generate` → `bun scripts/db-apply-sql.ts`（RDS 下 `db:push` 静默失败，沿用确定性工作流）。

---

## 3. 定价引擎（`features/credits/{constants/pricing.ts, lib/pricing.ts}`）

**基准 1 credit ≈ ¥0.01**；credits 为整数，`Math.max(1, Math.ceil(...))` 向上取整、单次至少 1（作者侧永不亏损）；`undefined` token 防御为 0 并 `console.warn`。费率已按**百炼 2026-09 中国内地真实单价**校准：

| 类型 | 定价（`CREDIT_PRICING`）| 真实成本对照 |
| --- | --- | --- |
| 对话 | 按模型 input/output 每 1K token 分价（如 flash 0.2/0.6、max 0.8/2.4；未列模型回退 `chatFallback`）| 百炼 output 通常 3-4 倍于 input |
| 图片 | `imagePerAsset=30` / `imageEditPerAsset=30`（T2I 与 I2I 同价）| qwen-image ≈¥0.2-0.3/张 |
| 视频 | 分辨率档每秒：`480P:30 / 720P:60 / 1080P:100` | 百炼中国内地 480P≈¥0.3、720P≈¥0.6、1080P≈¥1.0 每秒 |
| 知识库摄取 | `embeddingPer1k=0.1` | text-embedding-v4≈¥0.5/百万 token |

纯函数 `priceChat(modelKey, inputTokens, outputTokens)` / `priceImage(isEdit)` / `priceVideo(resolution, durationSeconds)` / `priceEmbedding(tokens)`。体验号建议额度 `DEFAULT_GRANT_TRIAL=500`（≈¥5，够 1 条 720P 短视频 + 大量对话/图片）。

---

## 4. 计费服务（`features/credits/api/service.ts`，server-only）

| 函数 | 行为 |
| --- | --- |
| `getBalance(userId)` | 读余额，无记录返回 0 |
| `checkBalance(userId)` | 入口拦截判据：`balance > 0` |
| `chargeCredits({userId,cost,kind,meta})` | **原子扣费**：事务内懒创建账户 → 单条 SQL `balance = balance - cost`（非读改写，PG 行锁防竞态）`RETURNING balanceAfter` → insert ledger（`delta=-cost`）。`cost` 经 `max(1,ceil)`；**不设「余额不足则跳过」，照扣至负** |
| `grantCredits({userId,amount,note})` | upsert 账户 `balance += amount` + ledger（`delta=+`，kind=grant）|
| `setBalance({userId,amount,note})` | 直接设定余额 + 写调整流水（`delta=新-旧`）|
| `listLedger(userId, filters)` | 流水分页（kind 可选筛选，createdAt 倒序）|

客户端经 `api/queries.ts`（`creditKeys` + `balanceQueryOptions`/`ledgerQueryOptions`）走 `/api/agent/credits*` 只读查询；**普通用户前端无写端点**（扣费在各入口内部）。发放/设定改由**管理员后台**经 `/api/admin/users/[id]/credits`（`isAdmin` 403 守卫）复用 `grantCredits`/`setBalance`，另有 CLI 应急后备。

---

## 5. 计费入口与拦截（402）

`api-error.ts` 的 `ApiErrorCode` 新增 `insufficient_credits`（HTTP **402**）。各入口在**发起上游调用前** `checkBalance`：

| 入口 | 拦截位置 | 拒绝形式 |
| --- | --- | --- |
| 对话 | `chat/route.ts` POST（限流后、建流前）| `apiError(402, 'insufficient_credits', …)` |
| 图片（工具）| `createImageAssetTool`/`editImageAssetTool`/`composeDesignTool`（整版设计内含一次文生图）execute 入口 | `throw new Error(INSUFFICIENT_CREDITS_MESSAGE)`（工具 output-error 展示中文）|
| 图片（直连生成）| `assets/generate` route（设计画布「AI 生成图片」，限流后、调用前）| `apiError(402, …)` |
| 图片（直连编辑）| `assets/[id]/edit` route（资产行「继续修改」+ 设计画布「AI 修改」）| `apiError(402, …)` |
| 视频（工具）| `createVideoAssetTool`/`createVideoFromImageAssetTool` execute（与 video 限流并列）| `throw new Error(INSUFFICIENT_CREDITS_MESSAGE)` |
| 知识库摄取 | `POST /documents`、`/documents/upload`、`/documents/[id]/retry` | `apiError(402, …)` |

文案单一来源 [`constants/credits.ts`](../src/features/credits/constants/credits.ts)：`INSUFFICIENT_CREDITS_MESSAGE`（中文，工具/前端展示）+ `INSUFFICIENT_CREDITS_API_MESSAGE`（英文，错误信封）。

> **不计费的产出**：`composeDesign` 的 design 落库为纯 JSON 组装（不调付费 API），只对其内含的一次文生图按 image 档扣费；本地图片上传（`assets/upload`）仅存储，同样不扣费。

---

## 6. 扣费时机（发起后按结果扣）★

「**发起后按结果扣** ≠ 预扣」：无冻结、无先扣后退；是上游调用**已发起**后依据结果决定是否实扣。

### 6.1 对话（`chat/route.ts` + `agent.ts` 的 usageSink 桥接）

`toUIMessageStream` 的 `onEnd` **有 `isAborted`/`outcome` 但无 usage**（UI 层不暴露 token），故须经 agent 层桥接：
1. route 创建可变累加器 `usageSink = { inputTokens:0, outputTokens:0 }` 传入 `buildAgent`。
2. `agent.ts` 的 `onStepEnd` 把每步 `usage` 累加进 `usageSink`（对**已完成的步**触发，含 abort 前的步；`undefined` 防御为 0）。
3. route 的 `toUIMessageStream onEnd` 读 `usageSink` + `isAborted` 结算：`priceChat(model, input, output)` → `chargeCredits(kind='chat', meta:{model,tokens,conversationId,aborted})`。
- **结算条件**：`hasUsage || outcome.status !== 'failed'`——completed/aborted 即使 usage 缺失也至少扣 1（兜底）；`failed` 且 0 token（无任何已完成步）→ 不扣。
- **停止不漏扣**：abort 时已完成步的 usage 已累加，onEnd（isAborted=true）照常结算。
- **刷新不双扣**：扣费仅在 POST 生产者的 `onEnd`；GET 重连（`/chat/[id]/stream`）只读 Redis 流，不触发结算。
- 结算失败（DB 异常）不阻断已完成的流（消息已持久化），仅 `console.error`。

### 6.2 图片 / 视频（`features/credits/lib/billing.ts` 的 `chargeOnGenerationResult`）

生成函数封装「提交→轮询→下载」，**不回吐 `task_id`**，故用统一的「发起后按结果扣」包裹：

```
chargeOnGenerationResult({ userId, kind, run, buildCharge, fallbackCharge })
  run() 成功            → chargeCredits(buildCharge(result))   // 含 assetId/分辨率/秒
  run() 抛 billable 错  → chargeCredits(fallbackCharge) 后 re-throw  // abort/超时/下载失败
  run() 抛其他错        → 不扣，re-throw                        // 鉴权/参数/限流/审核拒绝/本地转存失败
```
- `run()` 内含「上游生成 + 转存落库」；调用方须在 `run()` 前自行 `checkBalance`。
- 图片：`priceImage(isEdit)`；视频：`priceVideo(resolution, duration)`（成功用 `generateVideoAsset` 回吐的实际 resolution/duration，失败用入参兜底估算）。
- **图片计费调用点同一口径**：聊天工具 `createImageAssetTool`（T2I，`priceImage(false)`）/ 聊天工具 `composeDesignTool`（整版设计内含的 T2I，`priceImage(false)`，`meta.compose=true`；其后的 design 落库不再计费）/ 直连生成端点 `assets/generate`（设计画布 AI 生图，T2I，`priceImage(false)`）/ 直连编辑端点 `assets/[id]/edit` 与聊天 `editImageAssetTool`（I2I，`priceImage(true)`，`meta.sourceAssetId` 记血缘）；流水 `meta` 均带 `assetId` 与 `edit` 标志。
- 视频工具入口 `checkBalance` 与 `checkRateLimit('video', …)` 并列（任一不过即抛中文错误）。

### 6.3 知识库摄取（`knowledge/lib/{embeddings,ingest}.ts`）

- `embedTexts` 返回 `{ embeddings, tokens }`（累计 `embedMany` 的 `usage.tokens`）。
- `ingestChunks` **成功后** `chargeCredits(priceEmbedding(tokens), kind='knowledge', meta:{documentId,tokens})`；失败（status=failed）**不扣**。
- 计费失败不阻断已完成的摄取（否则会把 ready 文档误置 failed），仅 `console.error`。
- **检索豁免**：`knowledgeSearch` 的 `embedQuery`（单条 query）成本极低，**有意不计费**。

---

## 7. 生成错误分类（`features/agent/api/generation-error.ts`）

`GenerationError extends Error { billable }` + `isBillableError(error)`。`image-generation.ts`/`video-generation.ts` 的全部错误改抛 `GenerationError`，按百炼官方计费口径（**「失败不计费、仅对成功生成计费」，`DataInspectionFailed` 是 400 失败**）设 `billable`：

| 结果 | billable | 依据 |
| --- | :-: | --- |
| 成功（返回 buffer）| — | 直接扣（`buildCharge`）|
| Abort / 用户停止 | ✅ true | 客户端中断；任务已提交，上游可能已 SUCCEEDED 计费，无法确认 → 保守扣 |
| 轮询/请求超时 | ✅ true | 同上，上游可能已完成计费 |
| 下载阶段失败 / 体积超限 / MP4·PNG 校验失败 | ✅ true | 图·视频已生成，上游已计费 |
| **内容审核拒绝**（`DataInspectionFailed`）| ❌ **false** | **百炼「失败不计费」，审核拒绝是 400 失败，上游未计费**（照扣等于作者赚差价）|
| 鉴权失败 / 账户欠费（`InvalidApiKey`/`AccessDenied`/`Arrearage`）| ❌ false | 请求未受理 |
| 参数错误（`InvalidParameter`）/ 限流（`Throttling`）| ❌ false | 任务未创建 / 被拒 |
| 网络错误（提交前 fetch 失败）/ 配置缺失 / 非 JSON 网关错误 | ❌ false | 未到达上游 |

- 非 `GenerationError`（OSS/DB 转存失败等本地基础设施故障）`isBillableError` 返回 **false**（保守不扣，由作者吸收）。
- 防刷量由 `checkBalance`（0 余额拦截）+ 各入口 `checkRateLimit` 承担，**不靠「审核拒绝扣费」**。

---

## 8. 前端

- **账号下拉余额**（[`app-sidebar.tsx`](../src/components/layout/app-sidebar.tsx) 的 `SidebarFooter` DropdownMenu）：`<SidebarCreditsItem enabled={userMenuOpen} />`——受控 `open` 时才查 `GET /api/agent/credits`（`balanceQueryOptions`，`staleTime=30s`），**不常驻轮询**；点击进 `/dashboard/profile/credits`。
- **流水页** `/dashboard/profile/credits/page.tsx`（**具体路由，避开 `profile/[[...profile]]` catch-all**）：`credits-listing`（服务端预取）+ `credits-tables/*`（客户端 data-table，复用 `useDataTable` + `ledgerQueryOptions` + nuqs）+ `credits-balance-banner`。列 = 时间 / 类型徽标 / 变动 ± / 变动后余额 / 详情。
- **流水展示元数据**（[`constants/display.ts`](../src/features/credits/constants/display.ts)）：`CREDIT_KIND_LABELS`（发放/对话/图片/视频/知识库）+ `describeLedgerMeta` 把 meta 渲染为一句话（「对话 1.2K tokens（已停止）」「视频 720P 5s」「图片编辑（I2I）」「图片生成（整版设计主图）」「知识库摄取 500 tokens」「发放：体验额度」）。
- **402 文案映射**：`chat-window.tsx`（`DefaultChatTransport` 对非 2xx 抛 `Error(text)`，解析信封 `code==='insufficient_credits'` → 中文）、`image-edit-dialog.tsx` / `add-document-dialog.tsx`（`ApiError.status===402` → `INSUFFICIENT_CREDITS_MESSAGE`）、设计画布 `ai-generate-dialog.tsx` / `ai-edit-dialog.tsx`（经共用 [`design/lib/ai-image-error.ts`](../src/features/design/lib/ai-image-error.ts) 的 `resolveAiImageError`：402 → `INSUFFICIENT_CREDITS_MESSAGE`，429/413/404 → 中文提示，`code==='generation_failed'` → 服务端透传的中文生成错误原样展示）。

---

## 9. 管理员发放（Web 后台 + CLI）

**主路径**：用户管理后台 `/dashboard/admin/users`（仅 `ADMIN_USER_IDS` 白名单管理员，服务端 `isAdmin` 403 守卫）——列出全部用户 + 余额，行内「调整 Credits」对话框选 加/设 + 数额 + 备注，经 `POST /api/admin/users/[id]/credits` 复用 `grantCredits`/`setBalance`；同页可级联删除用户。

**应急后备**：CLI `scripts/credit-admin.ts`，复用 `features/credits/api/service`（经 `getDb()`）；能运行脚本（持 `DATABASE_URL`）即管理员，无应用内角色判定：

```bash
bun scripts/credit-admin.ts grant <userId> <amount> [--note "..."]   # 发放（upsert + 流水）
bun scripts/credit-admin.ts balance <userId>                          # 查询余额（无账户=0）
bun scripts/credit-admin.ts set <userId> <amount> [--note "..."]      # 直接设定余额（写调整流水）
```
无参数/非法参数打印用法并 `exit(1)`。冒烟脚本 `scripts/credit-smoke.ts` 验证 grant→charge→余额/流水/原子性/懒创建。

---

## 10. 关键约束与设计取舍

- **单次透支（固有）**：`balance > 0` 放行 + 无预扣/无估算 → 已 grant 账号单次调用可透支至负；余额负后 `checkBalance` 全拦。成本上界 = grant 额度 + 单次最大消耗（一条长视频）。对「0 余额拦截陌生人」目标已完全达成。
- **原子扣费**：`chargeCredits` 单条 SQL `balance = balance - cost`（非读改写）+ 同事务 insert ledger，PG 行锁防并发竞态。
- **对话超时链路**：`chargeCredits` 在 `onEnd`（流末尾）执行，不阻塞流式；`usageSink` 每请求新建（serverless 无状态，无跨请求污染）。
- **审核拒绝不扣的依据**：以百炼官方「失败不计费、仅对成功生成计费」为准，不臆断（详见 §7）。
- **结算不阻断主流程**：对话/知识库的 `chargeCredits` 失败仅记录日志，不回滚已完成的生成/摄取（避免因计费故障丢失用户产物）。

---

## 11. 明确延后（未实现）

预扣/冻结/退款、有效期/周期清零、多来源扣款排序、支付、低余额警告、事前估算弹窗/档位展示、基于角色的 admin 权限（当前用 `ADMIN_USER_IDS` env 白名单）、`knowledgeSearch` 检索计费、认证方 webhook 自动开户、余额变负的阻断（接受单次透支）。

---

## 12. 手动验收清单

- **发放/查询**：`credit-admin.ts grant` → 余额增加、流水有 grant 记录；`chargeCredits` → 余额原子减少、`balanceAfter` 正确；无账户 user `getBalance`=0。
- **拦截**：0 余额账号 → 对话/生图/生视频/知识库摄取全部 402，无上游调用。
- **对话**：grant 后对话 → 余额按 token 减少、流水 meta 记 tokens；**停止生成** → 已完成步 usage 仍扣；**刷新重连** → 不重复扣；`failed` 且 0 token → 不扣。
- **图片/视频**：成功 → 按张/秒扣；鉴权/参数/限流/**审核拒绝** → 不扣；abort/超时/下载失败 → 照扣（§7）。
- **知识库**：新增/上传/重试 → 摄取成功按 embedding tokens 扣；失败不扣；`knowledgeSearch` 不扣。
- **前端**：账号下拉打开显示余额；`/dashboard/profile/credits` 流水表展示每笔（类型/±/余额/详情摘要）；透支至负后后续调用被 402 拦。
