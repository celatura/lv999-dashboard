# Credits 消耗系统

Credits 是预付额度，不允许账户余额为负。新用户无额度；管理员可以发放或设定**可用额度**。对话、图片、视频和知识库摄取使用部署者的百炼 API Key，调用前必须原子预留，结束后结算并释放未用额度。

## 账户与流水

- `credits_accounts.balance` 是账户总额，`reserved` 是冻结额度，**可用额度 = balance - reserved**。数据库约束要求 `balance >= reserved >= 0`。
- `credit_reservations` 持久化每次预留的额度、类型、状态、计量信息、结算费用及实际扣款；对话内生成工具记录父预留和借用额度，结算在事务内幂等执行。
- `credit_ledger` 只记录发放、设定和实际扣款；`balanceAfter` 是当时的**总额**，不是可用额度。冻结和释放不改变总额，因此不写流水。
- `/api/agent/credits` 返回 `{ balance, reserved, total }`，其中 `balance` 是可用额度。账号菜单和 Credits 页面展示可用额度，后者同时展示总额与冻结额度。前端缓存可能短暂滞后，最终准入以数据库事务为准。
- 管理端和 CLI 的 `set` 设置的是可用额度：进行中的冻结额度不变，账户总额相应调整。`grant` 增加可用额度。

## 预留与结算

预留事务锁定账户行，检查可用额度并创建 `pending` 记录。并发操作不能重复使用同一份额度。无账户或可用额度不足时拒绝调用。所有预留均在上游调用前创建，`checkBalance` 仅是早期预检，不能替代预留。

| 入口 | 预留 | 成功结算 | 失败结算 |
| --- | --- | --- | --- |
| 图片生成、图片编辑、整版设计主图 | 单张固定价，须全额预留 | 按张数/结果计费 | 可计费错误按固定价扣；不可计费错误释放 |
| 文生视频、图生视频 | 请求时长 × 720P 固定价，须全额预留 | 按返回的分辨率和时长计费 | 可计费错误按预留固定价扣；不可计费错误释放 |
| 对话 | 请求 JSON 的 UTF-8 字节数加每步 4096 的余量，按最多 6 步输入及每步最多 8192 输出 token 估算；可用不足时预留全部可用额度 | 根据已完成步骤的 token usage 计费，停止也结算已完成步骤 | 失败且无已完成步骤 usage 时释放；无法取得的 usage 不能准确计量 |
| 知识库摄取、上传和重试 | 按所有片段的 UTF-8 字节数估算 embedding 费用；可用不足时预留全部可用额度 | 成功后按返回的 embedding tokens 计费 | 摄取失败不向用户收费；已知费用在预留记录中记为平台承担 |

对话预算并非严格费用上限：多模态、工具返回内容及 token 计数无法在调用前精确预测。**实际计价超过预留额度时，用户最多支付预留额度，其余由平台承担**；`actualCost`、`charged`、`absorbedCost` 记录在预留记录及有扣款时的流水中，服务端输出告警。该机制保证用户不透支，但不保证上游费用不超过预留额度，也不保证平台成本为零。价格只是内部计价，需与上游账单对账。上游不返回 usage 或中途失败时，费用可能无法完整获知；embedding 部分批次失败时等待同组请求结束、记录已知 usage 并标记 `usageIncomplete`，仍须对账。

`chargeOnGenerationResult` 覆盖全部图片和视频入口。`GenerationError.billable` 的既有规则保持不变：中止、任务提交后超时/网络中断、下载失败等上游可能已计费的情况扣费；鉴权、参数、限流、内容审核拒绝等不扣费。上游成功后本地资产转存或落库失败时，保留已知计价并由平台承担；任务状态未知时的扣费是估算（`costEstimated`），需要对账。

对话最多六步，每步输出上限 8192 token；这会限制超长输出。对话内图片/视频工具先使用可用额度，不足时从本次对话的冻结额度中原子转出（至少留 1 给对话），并创建独立预留；不能重复使用其他请求的冻结额度。工具结算时，未使用的借用额度在父预留仍有效时退回父预留，否则释放为可用额度。知识库检索 query embedding 维持免费。摄取的所有 embedding 批次共享 45 秒超时，并传递 abort signal；超时后无法确认的上游费用仍需对账。

## 价格

1 credit 约等于 ¥0.01；定价按 [`constants/pricing.ts`](../src/features/credits/constants/pricing.ts) 的模型输入/输出 token、图片张数、视频分辨率及秒数、embedding token 计算，向上取整，计费调用至少 1 credit。视频按上游成本定价，不覆盖存储、基础设施及异常成本。模型和供应商价格变化时需重新核对。

## 中断与对账

正常失败会释放或结算预留。若进程崩溃、平台强制终止，或者结算写库失败，预留保持 `pending`，**不会自动超时退款**：上游任务可能仍在运行或已经计费。检查日志中的 reservation ID，核对生成结果和上游账单后，由管理员人工处理。

```bash
bun scripts/credit-admin.ts balance <userId>
bun scripts/credit-admin.ts pending <userId>
# 必须确认相关工作进程已停止且该调用不会再结算；actualCost=0 表示释放
bun scripts/credit-admin.ts resolve <reservationId> <actualCost> --confirm-stopped
# 已知上游费用，但按失败规则不应向用户收费
bun scripts/credit-admin.ts resolve <reservationId> <actualCost> --confirm-stopped --waive
```

不要对仍在运行的任务人工结算，否则可能提前释放额度，允许重复使用。失败后是否应收取费用由管理员结合任务结果和既有失败规则决定。结算会保留预留 ID、费用和人工处理标记；重复结算相同结果无副作用，不同结果会报错。

## 迁移与部署

`drizzle/` 的迁移链可完整重放：`0000_baseline.sql` 建全部表（含 Credits 结构与约束），`0001_knowledge_hnsw.sql` 补 pgvector HNSW 索引。空库执行 `bun run db:migrate` 即可建好；已应用状态记录在 `drizzle.__drizzle_migrations`，不会重复执行。

今后修改 schema 时，先备份并确认目标数据库，再运行 `bun run db:generate` 生成增量 SQL、`bun run db:migrate` 应用。迁移前停止旧版写入和在途任务，迁移成功后再启动对应版本。已有数据但尚无迁移记录的旧库，先执行 `bun run db:stamp`（默认 dry-run，确认后加 `--apply`）接入。

## 验证

在**已迁移的隔离测试库**运行 `bun run scripts/credit-smoke.ts`，覆盖并发预留、父子预留、幂等结算、释放、超额承担、管理员调整及待对账预留。`scripts/knowledge-smoke.ts` 会调用真实 embedding API，需测试数据库及有效 API Key，会产生上游费用。

手动验证：零额度返回 402；固定价并发请求只能使用可用额度；一次对话或摄取后冻结释放、流水总额与实际扣款一致；审核拒绝释放图片/视频预留；停止生成按已有 usage 结算；强杀工作进程后预留仍可由 `pending` 查询，核对后人工结算。
