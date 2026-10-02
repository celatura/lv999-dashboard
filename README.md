# LV999 · AI 原生多模态创作平台

> **LV999** —— lv = level。功能拉满、什么都有、完全体的多模态创作工作台。

一个 AI 原生的多模态创作平台：用自然语言对话创作 **文本 / 图片 / 视频 / 设计**，以 **RAG 知识库**做语义增强，全部产出沉淀为可管理的资产——已接入真实后端（PostgreSQL + 对象存储 + Redis + 大模型）。它的底层是一套功能拉满的生产级**后台底座**（认证、权限、数据表格、表单、图表、主题……端到端可用），既能支撑本平台自身，也能直接长出其他真实业务。

![LV999 预览](./public/lv999-dashboard.png)

## 功能特性

- **AI Agent 创作**：自然语言对话驱动的创作工作台，产出 Markdown / HTML 文本、文生图 / 图生图、文生视频 / 图生视频与一句话整版设计；可恢复流式输出，刷新自动重连、支持跨实例停止。详见 [docs/agent.md](./docs/agent.md)
- **专家模式（技能系统）**：会话级选定一个专家技能，Agent 按其人设、工作流与 few-shot 示例协作，并以 `tools` 白名单限定可用工具；内置 3 个预置 + 用户自建技能（`/dashboard/skills` 管理）
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
| 框架 | Next.js 16（App Router） |
| 语言 | TypeScript 5.7（strict） |
| UI 组件 | shadcn/ui（Base UI primitives） |
| 样式 | Tailwind CSS v4 |
| 认证 | Better Auth（自托管 · 邮箱密码） |
| AI / Agent | AI SDK v7（`ai` + `@ai-sdk/alibaba` / `@ai-sdk/openai-compatible`），百炼（阿里云 Model Studio） |
| 设计画布 | Konva + react-konva（2D canvas） |
| 向量检索 / RAG | pgvector（阿里云 RDS） + 百炼 `text-embedding-v4` embedding |
| 数据库 / ORM | PostgreSQL（阿里云 RDS） + Drizzle ORM |
| 对象存储 | 阿里云 OSS（图片 / 视频等二进制资产；视频封面用 OSS 原生截帧） |
| 缓存 / 流恢复 | Redis（resumable-stream 与停止信号 / 限流） |
| 数据请求 | TanStack Query v5（SSR + Suspense） |
| 数据表格 | TanStack Table v8 |
| 表单 | TanStack Form + Zod v4 |
| URL 状态 | nuqs |
| 图表 | Recharts |
| 命令面板 | kbar |
| 代码检查 / 格式化 | Oxlint / Oxfmt + Husky（pre-commit） |
| 包管理器 | Bun（推荐）或 npm |

## 页面一览

| 路由 | 说明 |
| --- | --- |
| `/dashboard/overview` | 总览：统计卡片 + 图表（并行路由独立加载） |
| `/dashboard/agent` | Agent 创作：新建会话与对话创作入口 |
| `/dashboard/agent/[conversationId]` | Agent 会话：可恢复流式对话、工具调用与对话内资产卡片 |
| `/dashboard/skills` | 技能管理：内置技能（只读）+ 用户自建专属技能的 CRUD |
| `/dashboard/assets` | 我的资产：资产表格（筛选 / 搜索 / 预览 / 下载 / 删除） |
| `/dashboard/design` | 设计画布：新建空白画布 |
| `/dashboard/design/[id]` | 设计画布：打开已存设计继续编辑 |
| `/dashboard/knowledge` | RAG 知识库：文档管理（新增 / 列表 / 删除 / 重试） |
| `/dashboard/admin/users` | 用户管理（仅管理员）：列出全部用户、调整 Credits、级联删除账号 |
| `/dashboard/profile` | 个人资料与安全设置（改名字 / 改密码 / 登出） |
| `/dashboard/profile/credits` | 我的积分：Credits 余额与流水明细 |
| `/auth/sign-in`、`/auth/sign-up` | 登录 / 注册 |

## 快速开始

**前置要求**：Node.js 22（见 `.nvmrc`）或 Bun，推荐使用 Bun。

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
cp env.example.txt .env.local
# 然后至少填入 BETTER_AUTH_SECRET / BETTER_AUTH_URL 与 DATABASE_URL（总览 / 资产等页直连数据库，缺一不可，见下方说明）

# 3. 初始化数据库 schema（首次 / 空库必做，否则数据页因缺表报错）
#    pgvector 前置：先在目标库执行 CREATE EXTENSION IF NOT EXISTS vector;
bunx drizzle-kit generate      # 由 schema.ts 生成迁移 SQL（无需连库）
bun scripts/db-apply-sql.ts    # 应用迁移 SQL 到 DATABASE_URL

# 4. 启动开发服务器
bun run dev
```

访问 http://localhost:3000。

> **关于建表**：`bun run db:push`（`drizzle-kit push`）在部分托管实例（如阿里云 RDS）会在连接阶段静默失败，故采用「`drizzle-kit generate` 生成 SQL → `scripts/db-apply-sql.ts` 应用」的确定性工作流；知识库的 HNSW 向量索引需手动补进迁移 SQL。详见 [docs/agent.md](./docs/agent.md) 与 [docs/knowledge-base.md](./docs/knowledge-base.md)。

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
| `bunx drizzle-kit generate` | 由 `schema.ts` 生成迁移 SQL（无需连库） |
| `bun scripts/db-apply-sql.ts` | 应用迁移 SQL 到 `DATABASE_URL`（RDS 下替代静默失败的 `db:push`） |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` / `bun run lint:strict` | Oxlint 检查 |
| `bun run lint:fix` | 自动修复并格式化 |
| `bun run format` / `bun run format:check` | Oxfmt 格式化 / 校验 |

## 项目结构

```plaintext
src/
├── app/                    # Next.js App Router
│   ├── auth/               # 登录 / 注册页
│   ├── dashboard/          # 后台路由
│   │   ├── overview/       # 总览（并行路由：@area_stats、@bar_stats、@pie_stats、@sales）
│   │   ├── agent/          # Agent 创作（会话列表 + [conversationId] 会话页）
│   │   ├── skills/         # 技能管理（内置只读 + 用户自建专属技能 CRUD）
│   │   ├── assets/         # 我的资产（资产表格）
│   │   ├── design/         # 设计画布（新建 + [id] 编辑页）
│   │   ├── knowledge/      # RAG 知识库（文档管理）
│   │   ├── admin/          # 用户管理后台（仅管理员：列用户 / 调 Credits / 删号）
│   │   └── profile/        # 个人资料
│   └── api/                # Route Handlers：agent（chat / conversations / assets / knowledge）+ admin（用户管理）
├── components/
│   ├── ui/                 # shadcn/ui 组件库
│   ├── layout/             # 布局（侧边栏、顶栏、Infobar 等）
│   ├── forms/              # 表单字段组件（Field anatomy）
│   ├── themes/             # 主题系统
│   └── kbar/               # ⌘K 命令面板
├── features/               # 按功能划分的模块（agent、design、knowledge、credits、admin、auth、overview、profile）
│   └── <name>/
│       ├── api/            # types.ts → service.ts → queries.ts
│       ├── components/
│       ├── schemas/        # Zod 校验
│       └── constants/      # 筛选 / 选项配置
├── config/                 # 导航配置（nav-config）、表格配置（data-table）
├── hooks/                  # 自定义 hooks
├── lib/                    # 工具（query-client、searchparams、api-client、oss、redis 等）
│   └── db/                 # Drizzle schema（含 pgvector 向量列）与连接（getDb）
├── styles/                 # 全局样式与主题 CSS
└── types/                  # 类型定义
```

## 核心设计

- **数据获取（TanStack Query SSR）**：服务端 `prefetchQuery`（`void` 触发不阻塞）→ `HydrationBoundary` + `dehydrate` 注水 → 客户端 `useSuspenseQuery` 消费，配合 `<Suspense>` 展示骨架屏。
- **Service 层三件套**：每个 feature 的 `api/` = `types.ts`（类型契约）/ `service.ts`（数据访问，接后端唯一需替换的文件）/ `queries.ts`（查询选项 + 键工厂，稳定不变）；支持 Server Actions、Route Handlers、BFF 代理、直连外部 API 多种接入。
- **AI Agent 创作**：自然语言 → AI SDK v7 `ToolLoopAgent` → 文本 / 图片 / 视频作品统一沉淀为资产；后端为 PostgreSQL + Drizzle（`conversations` / `messages` / `assets` 三表）、OSS、Redis、百炼大模型。详见 [docs/agent.md](./docs/agent.md)。
- **设计画布**：Konva 纯客户端孤岛，文档为可序列化 JSON、作为 `kind='design'` 资产落库（不新增表）；画布内直连 T2I / I2I 与 `composeDesign`，产出即时插入 / 替换并走 Credits 计费。详见 [docs/design-editor.md](./docs/design-editor.md)。
- **RAG 知识库**：文本 / 上传文件经切分 → 百炼 `text-embedding-v4` → pgvector（`knowledge_documents` / `knowledge_chunks` 两表 + HNSW 索引）；Agent 经 `knowledgeSearch` 语义检索 topK 片段作答并标注来源。详见 [docs/knowledge-base.md](./docs/knowledge-base.md)。
- **视频产物**：AI SDK v7 `experimental_generateVideo` + `@ai-sdk/alibaba`（默认 `wan3.0-video`），作为 `kind='video'` 资产落库（不新增表），封面用 OSS 原生截帧经同源代理下发。详见 [docs/video-generation.md](./docs/video-generation.md)。
- **Credits 成本管控**：调用部署者真实 API Key，故新用户默认 0 分、付费入口先 `checkBalance`（不足返回 402）；按真实 usage「发起后按结果扣」，依百炼「失败不计费」口径，`credits_accounts` + `credit_ledger` 两表原子扣费。详见 [docs/credits.md](./docs/credits.md)。
- **用户管理后台**：管理员（`ADMIN_USER_IDS` + 服务端 `isAdmin`）列用户 / 调 Credits / 级联删号（Better Auth user → 7 表事务 → OSS）；多租户组织功能已移除、改为单管理员模型。详见 [docs/user-management.md](./docs/user-management.md)。
- **URL 状态（nuqs）**：服务端 `searchParamsCache` 读、客户端 `useQueryState(shallow: true)` 写，表格分页 / 筛选零 RSC 往返、可分享还原。
- **表单（TanStack Form + Zod）**：`createFormHook` + 可复用 Field 组件，提交走 `useMutation` + 查询键失效。详见 [docs/forms.md](./docs/forms.md)。
- **权限**：`nav-config.ts` 声明导航、客户端 `useFilteredNavGroups()` 同步过滤（仅 UX）；真正鉴权是服务端 `isAdmin` 与 dashboard/layout 的 `verifySession()`（org-based RBAC 已退役）。详见 [docs/nav-rbac.md](./docs/nav-rbac.md)。
- **主题系统**：`[data-theme]` + CSS 变量驱动，`active_theme` cookie 持久化。详见 [docs/themes.md](./docs/themes.md)。

## 部署

- **Vercel**：连接仓库、配置环境变量即可一键部署。
- **Docker**：内置 `Dockerfile`（Node.js）与 `Dockerfile.bun`（Bun），基于 Next.js standalone 输出，镜像更小。

完整说明见 [docs/deployment.md](./docs/deployment.md)。

## 许可证与致谢

本项目基于 [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) 二次开发，感谢原作者 [Kiranism](https://github.com/Kiranism) 的开源工作。

项目采用 [MIT License](./LICENSE)，原始版权声明已保留在 LICENSE 文件中。
