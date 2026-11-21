# LV999 · AI 原生多模态创作平台

> **LV999** —— lv = level。功能拉满、什么都有、完全体的多模态创作工作台。

用自然语言对话创作 **文本 / 图片 / 视频 / 设计**，以 **RAG 知识库**做语义增强，全部产出沉淀为可管理的资产——后端为真实 PostgreSQL / 对象存储 / Redis / 大模型。底层是一套生产级**后台底座**（认证、权限、数据表格、表单、图表、主题，端到端可用），也能直接长出其他真实业务。

![LV999 预览](./public/lv999-dashboard.png)

## 功能特性

- **AI Agent 创作**：自然语言对话驱动的创作工作台，产出 Markdown / HTML 文本、文生图 / 图生图、文生视频 / 图生视频与一句话整版设计；流式输出可恢复（刷新自动重连、可停止）；消息可复制 Markdown 源码、重新生成最后一条。详见 [docs/agent.md](./docs/agent.md)，视频另见 [docs/video-generation.md](./docs/video-generation.md)
- **技能系统（按需加载的专家工作流）**：Agent 按任务自动加载完整工作流，也可为单条消息指定技能；技能可声明工具边界，支持从模板一键新建。管理入口 `/dashboard/skills`
- **对话内资产引用**：从「我的资产」挑选资产随消息提交，让模型确定性拿到 assetId、无需再检索
- **AI 原生设计画布**：Konva 画布摆放文字 / 图形 / 图片，画布内直接 AI 生图 / 改图、对话内一句话生成整版设计，支持多选 / 复制粘贴 / 吸附对齐，导出 PNG 并沉淀为可再编辑资产。详见 [docs/design-editor.md](./docs/design-editor.md)
- **RAG 知识库**：文本与上传文件（PDF / Office / Markdown）切分向量化存入 pgvector，Agent 按语义检索作答并标注来源；页面可预览切分片段、做检索测试。详见 [docs/knowledge-base.md](./docs/knowledge-base.md)
- **我的资产**：Agent 与画布产出统一沉淀为 markdown / html / image / design / video 五类资产，支持筛选 / 搜索 / 预览 / 下载 / 收藏 / 批量删除，图片视频经 OSS 签名 URL 访问
- **直连图片编辑**：图片资产「继续修改」直连图生图（不经聊天），产出派生资产并记录血缘
- **成本管控（Credits）**：对话 / 生图 / 生视频 / 知识库摄取按 Credits 扣费，新用户默认 0 分、余额不足即拒，杜绝陌生人刷爆 API Key；管理员经后台发放额度。详见 [docs/credits.md](./docs/credits.md)
- **总览仪表盘**：统计卡片 + Recharts 图表，基于并行路由各区块独立加载，已接真实数据
- **管理员用户管理后台**：`ADMIN_USER_IDS` 白名单 + 服务端 `isAdmin` 校验，列用户 / 调 Credits / 级联删号（仅管理员可见）。详见 [docs/user-management.md](./docs/user-management.md)
- **生产级后台底座**：TanStack Query SSR 数据表格（搜索 / 筛选 / 排序 / 分页与 URL 同步）、TanStack Form + Zod 表单、Better Auth 自托管认证、⌘K 命令面板、多主题架构、Infobar 提示侧栏——端到端可用，亦可直接长出其他业务

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | [Next.js 16](https://nextjs.org)（App Router）· React 19 |
| 语言 | [TypeScript 7](https://www.typescriptlang.org)（strict） |
| UI 组件 | [shadcn/ui](https://ui.shadcn.com)（[Base UI](https://base-ui.com) primitives） |
| 样式 | [Tailwind CSS v4](https://tailwindcss.com) + [next-themes](https://github.com/pacocoursey/next-themes)（CSS 变量多主题） |
| 认证 | [Better Auth](https://www.better-auth.com)（自托管 · 邮箱密码 · SMTP 密码重置） |
| AI / Agent | [AI SDK v7](https://ai-sdk.dev)（`ai` + `@ai-sdk/alibaba`），百炼（阿里云 Model Studio） |
| 流式渲染 | [Streamdown](https://streamdown.ai)（代码高亮 / CJK 插件） |
| 设计画布 | [Konva](https://konvajs.org) + [react-konva](https://konvajs.org/docs/react/)（2D canvas） |
| 向量检索 / RAG | [pgvector](https://github.com/pgvector/pgvector)（阿里云 RDS） + 百炼 `text-embedding-v4` embedding |
| 文档解析 | [@firecrawl/anydoc](https://www.npmjs.com/package/@firecrawl/anydoc)（PDF / Office / EPUB → Markdown） |
| 数据库 / ORM | PostgreSQL（阿里云 RDS） + [Drizzle ORM](https://orm.drizzle.team) |
| 对象存储 | 阿里云 OSS（图片 / 视频等二进制资产；视频封面用 OSS 原生截帧） |
| 缓存 / 流恢复 | [Redis](https://redis.io)（[resumable-stream](https://www.npmjs.com/package/resumable-stream) 与停止信号 / 限流） |
| 数据请求 | [TanStack Query v5](https://tanstack.com/query)（SSR + Suspense） |
| 数据表格 | [TanStack Table v9](https://tanstack.com/table) |
| 表单 | [TanStack Form](https://tanstack.com/form) + [Zod v4](https://zod.dev) |
| URL 状态 | [nuqs](https://nuqs.dev) |
| 图表 | [Recharts](https://recharts.org) |
| 命令面板 | [kbar](https://kbar.vercel.app) |
| 代码检查 / 格式化 | [Oxlint](https://oxc.rs/docs/guide/usage/linter) / [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) + [Husky](https://typicode.github.io/husky/)（pre-commit） |
| 包管理器 | [Bun](https://bun.sh)（推荐）或 npm |

## 页面一览

| 路由 | 说明 |
| --- | --- |
| `/dashboard/overview` | 总览：统计卡片 + 图表（并行路由独立加载） |
| `/dashboard/agent`（含 `[conversationId]`） | Agent 创作：新建会话、可恢复流式对话、工具调用与资产卡片 |
| `/dashboard/skills` | 技能管理：专属技能 CRUD（可从模板一键新建） |
| `/dashboard/assets` | 我的资产：筛选 / 搜索 / 预览 / 下载 / 删除 |
| `/dashboard/design`（含 `[id]`） | 设计画布：新建空白画布 / 打开已存设计继续编辑 |
| `/dashboard/knowledge` | RAG 知识库：文档管理（新增 / 列表 / 删除 / 重试） |
| `/dashboard/admin/users` | 用户管理（仅管理员）：列用户、调整 Credits、级联删除账号 |
| `/dashboard/profile`（含 `/credits`） | 个人资料与安全设置；Credits 余额与流水明细 |
| `/auth/sign-in`、`/auth/sign-up` | 登录 / 注册 |

## 快速开始

**前置要求**：Node.js 26（见 `.nvmrc`）或 Bun，推荐使用 Bun。

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
cp env.example.txt .env.local
# 然后至少填入 BETTER_AUTH_SECRET / BETTER_AUTH_URL 与 DATABASE_URL（总览 / 资产等页直连数据库，缺一不可，见下方说明）

# 3. 初始化数据库（空库一条命令建全部表与索引；已有库见下方说明）
bun run db:migrate

# 4. 启动开发服务器
bun run dev
```

访问 http://localhost:3000。

> **关于数据库**：`drizzle/` 是「单基线 + 增量」迁移链，空库 `bun run db:migrate` 一条命令建好全部表与索引（含 pgvector）；改 schema 后 `db:generate` → `db:migrate`。RDS 下 `drizzle-kit push` 会静默失败，项目不提供 `db:push`；已有数据的旧库用 `db:stamp` 接入。详见 [docs/agent.md](./docs/agent.md) §12。

### 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Better Auth 密钥（≥32 字符）与应用基础 URL，必填 |
| `ADMIN_USER_IDS` | 平台管理员白名单（逗号分隔的 Better Auth user id），用户管理后台鉴权；留空 = 无管理员 |
| `NEXT_PUBLIC_APP_URL` | 应用公开地址（用于 metadataBase，本地为 `http://localhost:3000`） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 密码重置邮件（可选，未配则重置不可用） |
| `BUILD_STANDALONE` | Docker / 自托管时设为 `"true"`，启用 standalone 输出 |
| `DATABASE_URL` | PostgreSQL 连接串（总览 / 资产 / Agent / 知识库 / 设计等数据层均需，未配会报错） |
| `DASHSCOPE_API_KEY` | 阿里云百炼 API Key（对话与图片模型） |
| `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 阿里云 OSS（图片等二进制资产） |
| `REDIS_URL` | Redis 连接串（流恢复 / 停止信号 / 限流，需 pub/sub） |

后台页至少需 Better Auth 密钥 + `DATABASE_URL`；`DASHSCOPE_API_KEY` / OSS / `REDIS_URL` 仅创作能力（Agent 模块）需要。完整变量见 `env.example.txt`，认证配置见 [docs/auth.md](./docs/auth.md)。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 启动开发服务器 |
| `bun run build` / `bun run start` | 生产构建 / 启动 |
| `bun run db:migrate` | 应用未执行的迁移到 `DATABASE_URL`（空库初始化也用它） |
| `bun run typecheck` | TypeScript 类型检查 |

db 系列（`db:generate` / `db:check` / `db:stamp`）、lint / format / `skills:check` 等完整命令见 [AGENTS.md](./AGENTS.md)。

## 项目结构

```plaintext
src/
├── app/           # Next.js App Router：auth / dashboard 路由 + api Route Handlers
├── features/      # 按功能划分的业务模块（agent / design / knowledge / credits / admin ...）
│   └── <name>/    #   api（types / service / queries / mutations）、components、schemas、constants
├── components/    # 通用组件：ui（shadcn）、layout、forms、themes、kbar
├── config/        # 导航（nav-config）与表格（data-table）配置
├── hooks/         # 自定义 hooks
├── lib/           # 工具（query-client / api-client / oss / redis / auth-session）与 db（schema + getDb）
├── styles/        # 全局样式与主题 CSS
└── types/         # 类型定义
```

完整目录说明见 [AGENTS.md](./AGENTS.md)。

## 核心设计

- **Service 层**：每个 feature 的 `api/` 分四文件——`types.ts` 契约 / `service.ts` 服务端数据访问 / `queries.ts` / `mutations.ts`；客户端只经 `apiClient` 调 Route Handler，不直接引用 `service.ts`。
- **数据获取**：TanStack Query SSR——服务端预取直连 `service.ts` + `HydrationBoundary` 注水，客户端 `useSuspenseQuery` 消费；表格分页 / 筛选用 nuqs 走 URL 状态，零 RSC 往返。详见 [AGENTS.md](./AGENTS.md)。
- **AI Agent 创作**：自然语言 → AI SDK v7 `ToolLoopAgent` → 文本 / 图片 / 视频 / 设计统一沉淀为资产；流式可恢复、可跨实例停止。详见 [docs/agent.md](./docs/agent.md)。
- **设计画布**：Konva 纯客户端孤岛，文档为可序列化 JSON、作为 `kind='design'` 资产落库（不新增表）。详见 [docs/design-editor.md](./docs/design-editor.md)。
- **RAG 知识库**：文本 / 文件 → 切分 → 百炼 embedding → pgvector（HNSW），Agent 语义检索并标注来源。详见 [docs/knowledge-base.md](./docs/knowledge-base.md)。
- **Credits 成本管控**：调用部署者真实 API Key，新用户默认 0 分；付费入口先预留额度（不足 402）、按真实 usage 结算，超额由平台承担。详见 [docs/credits.md](./docs/credits.md)。
- **权限**：客户端导航过滤仅 UX；真正鉴权是服务端 `isAdmin` 白名单与 `verifySession()`（单管理员模型，org RBAC 已退役）。详见 [docs/nav-rbac.md](./docs/nav-rbac.md)。
- **表单 / 主题**：TanStack Form + Zod（详见 [docs/forms.md](./docs/forms.md)）；`[data-theme]` + CSS 变量多主题（详见 [docs/themes.md](./docs/themes.md)）。

## 部署

- **Vercel**：连接仓库、配置环境变量即可一键部署。
- **Docker**：内置 `Dockerfile`（Node.js）与 `Dockerfile.bun`（Bun），基于 Next.js standalone 输出，镜像更小。

完整说明见 [docs/deployment.md](./docs/deployment.md)。

## 许可证与致谢

本项目基于 [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) 二次开发，感谢原作者 [Kiranism](https://github.com/Kiranism) 的开源工作。

项目采用 [MIT License](./LICENSE)，原始版权声明已保留在 LICENSE 文件中。
