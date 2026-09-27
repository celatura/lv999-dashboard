# RAG 知识库

LV999 Dashboard 的检索增强模块：把用户沉淀的文本知识切分、向量化存入 pgvector，Agent 在对话中按**语义**检索相关片段来作答/创作并标注来源。是「复用资产库」（`findAssets`/`readAsset` 按标题）的语义级升级（按内容含义检索）。

> 向量存 **pgvector**（阿里云 RDS PostgreSQL）；embedding 走**百炼 `text-embedding-v4`**（OpenAI 兼容模式）——检索/向量化链路零新增 npm 依赖、零新增外部服务、零新增环境变量（复用 `DASHSCOPE_API_KEY`）。
> **文件上传来源**（`source='file'`）另引入 [`@firecrawl/anydoc`](https://github.com/firecrawl/anydoc) v0.2.4（MIT，napi 原生模块）把 PDF/Office 等文档解析为结构化 Markdown，见 §4.1。

---

## 1. 概览

- **入口**：`/dashboard/knowledge`（知识库管理，data-table）；检索能力经 Agent 对话内的 `knowledgeSearch` 工具触发（无独立搜索页）。
- **文档来源**：`manual`（手动粘贴文本）/ `asset`（从 markdown/html 文本资产导入）/ `file`（上传 PDF/Office/Markdown 等文件，服务端解析为 Markdown/文本）。
- **摄取**：（file 来源先解析提取文本）→ 切分 → 批量 embedding → 片段落 pgvector；文档状态 `processing → ready / failed`（失败可重试）。
- **检索**：`knowledgeSearch` 工具 → 语义 topK → Agent 依据片段作答、用文档标题标注来源。

---

## 2. 数据模型（`src/lib/db/schema.ts` 两表 + pgvector）

前置：RDS 需启用扩展 `CREATE EXTENSION IF NOT EXISTS vector;`。向量列类型经 [`src/lib/db/vector.ts`](../src/lib/db/vector.ts) 的 `customType` 定义（`vector1024`，维度 `VECTOR_DIM`，`toVectorLiteral` 负责序列化）。

**`knowledge_documents`**：`id` / `userId` / `title` / `source`(`manual`|`asset`|`file`) / `sourceAssetId`(FK→assets, ON DELETE SET NULL；file 来源恒为 null) / `content`(原始全文/提取文本，供重嵌与展示) / `status`(`processing`|`ready`|`failed`) / `chunkCount` / 时间戳。索引 `(userId, createdAt)`。

**`knowledge_chunks`**：`id` / `documentId`(FK→knowledge_documents, **ON DELETE CASCADE**) / `userId`(冗余，检索按用户过滤免 join) / `chunkIndex` / `content` / `embedding vector(1024)` / `createdAt`。索引 `(userId)`。

**HNSW 向量索引**（drizzle-kit 不生成，迁移 SQL 手动追加）：
```sql
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
```

---

## 3. Embedding 通道

- 配置集中在 [`src/features/agent/constants/embedding.ts`](../src/features/agent/constants/embedding.ts)：`EMBEDDING_MODEL='text-embedding-v4'`、`EMBEDDING_DIM=VECTOR_DIM`、`EMBED_BATCH_SIZE=10`（百炼兼容模式单次上限 10 行）。
- [`provider.ts`](../src/features/agent/api/provider.ts) 的 `resolveEmbeddingModel()` = `getCompatibleProvider().embeddingModel('text-embedding-v4')`（复用兼容 provider 与 API Key；注意包 API 为 `embeddingModel()`，`textEmbeddingModel()` 已废弃）。维度经 `providerOptions.openaiCompatible.dimensions` 传入。
- [`knowledge/lib/embeddings.ts`](../src/features/knowledge/lib/embeddings.ts)：`embedQuery`（检索单条）、`embedTexts`（摄取分批，`EMBED_BATCH_SIZE` 分批 + 并发 3）；每条向量 `assertDim` 校验维度，与列不一致立即失败。

---

## 4. 摄取管线（`src/features/knowledge/lib/`）

**按来源获取文本** → 切分 → 向量化 → 落库：

1. **文本获取**（按来源分支）：`manual` 用提交正文；`asset` 经 `loadAssetText`（`getAsset` 归属校验 → 仅 `markdown`/`html`，其他抛 `asset_unsupported` → html 经 `htmlToText()` 去标签）；`file` 经 `extractTextFromFile`（解析上传文件，见 §4.1）。
2. `chunkText`（[`chunk.ts`](../src/features/knowledge/lib/chunk.ts)）：以句末标点/换行为原子边界累积到约 `CHUNK_TARGET_CHARS=700` 字/片段、重叠 `80` 字，超长句按 `300` 字硬切。纯函数无依赖。
3. `prepareChunks`：入库前校验（空/超 `MAX_DOCUMENT_BYTES=100KB`/超 `MAX_CHUNKS_PER_DOCUMENT=200`），失败不产生垃圾文档行。
4. `ingestChunks`：`embedTexts` → `replaceChunks`（**事务**内先清旧片段再插新片段并置 `ready`，避免中间态被检索）；异常置 `failed`（不抛给用户，前端可重试）。
- **执行位置**：POST 请求内**同步**摄取（`maxDuration=60`；正文有 100KB 上限）。

### 4.1 文件解析（[`extract.ts`](../src/features/knowledge/lib/extract.ts) + `@firecrawl/anydoc`）

把上传文件解析为 Markdown/纯文本，是 `file` 来源进入摄取管线的前置环节。

- **选型 `@firecrawl/anydoc`（v0.2.4，MIT）**：单库覆盖 14 种格式（Word/PPT/Excel/OpenDocument/RTF/EPUB/CSV + 文本型 PDF），输出**结构化 GFM Markdown**（保留标题/表格/列表/脚注/公式转 LaTeX），中位 4.4ms、纯本地无网络无 API key。相比纯文本方案，**结构化 Markdown 让现有 `chunkText` 切分更语义化、检索更精准**。
- **分派策略**（`extractTextFromFile`）：`md`/`txt`/`html` 本就是文本 → **零依赖**（UTF-8 decode / `stripFrontmatter` 去 YAML 头 / 复用 `htmlToText`）；office/pdf/epub/rtf/csv → `anydoc.toMarkdownBytes(buffer, format)`（**基于内容签名检测格式**，扩展名标错也能识别；CSV 无签名需 `formatFromExtension('csv')` 显式声明，其余传 `null` 交内容检测）。Buffer 本身即 Uint8Array，直接传入避免拷贝。
- **NAPI 原生二进制的 serverless 适配**：anydoc Node 绑定是 napi-rs 原生 `.node`，[`next.config.ts`](../next.config.ts) 的 `serverExternalPackages` 含 `['ali-oss', '@firecrawl/anydoc']`（不参与打包，运行时由 Node 直接加载）。
- **错误映射**：anydoc 错误码（v0.2.x 小写驼峰）→ `KnowledgeExtractError`（snake_case code）→ HTTP：`needsOcr`→`needs_ocr`（扫描件/图片型 PDF，**未启用联网 OCR**）、`encrypted`→`encrypted`、`unsupported`→`unsupported_type`、`resourceLimit`→`too_large`、`malformed`/`missingPart`→`parse_failed`；原始 error 作 `cause` 保留 + `console.error` 记录，用户仅见中文提示。
- **上限与防御**（`assertText`）：提取文本 `trim()` 为空 → `empty_text`（不建文档行）；超 `MAX_DOCUMENT_BYTES=100KB` → `too_large`。上传文件原始字节上限 `MAX_UPLOAD_FILE_BYTES=10MB`（端点校验）。允许扩展名白名单 `ACCEPTED_FILE_EXTENSIONS`（[`extract.ts`](../src/features/knowledge/lib/extract.ts)，19 种）后端强制校验，前端 accept 见 `KNOWLEDGE_FILE_ACCEPT`（[`constants/files.ts`](../src/features/knowledge/constants/files.ts)）。

---

## 5. 检索 + Agent 集成

- [`search.ts`](../src/features/knowledge/lib/search.ts) `searchKnowledgeByText`：`embedQuery` → `searchKnowledge`（[`service.ts`](../src/features/knowledge/api/service.ts)）用 `embedding <=> queryVec::vector` cosine 距离升序取 topK，**仅检索 `status='ready'` 的片段**，`score = 1 - 距离`；再按 `SEARCH_MIN_SCORE=0.45` 过滤低相关片段（避免噪声污染上下文、诱导"强行引用"；阈值经真实语料标定，见 `constants/knowledge.ts`）。
- Agent 工具 [`agent.ts`](../src/features/agent/api/agent.ts) `knowledgeSearch`（与 `findAssets`/`readAsset` 并列，同时登记进 `agentValidationTools` 与 `buildAgent.tools`）：输入 `{ query, topK?(1..8 默认 5) }`，返回 `results: [{ documentId, documentTitle, chunkIndex, content, score }]`；空结果提示"知识库中未找到相关资料，不要编造"。
- **检索测试（调试台面板）**：知识库页「检索测试」→ `POST /api/agent/knowledge/search` → 复用同一 `searchKnowledgeByText`（同一 `embedQuery` + 同 `SEARCH_MIN_SCORE` 过滤 + 同 topK 上限），保证「测试所见 = 对话所得」；零计费（`embedQuery` 已豁免，见 [docs/credits.md](./credits.md) §6.3）。
- 指令区分：`findAssets` 按**标题**找「作品」（复用/改写）；`knowledgeSearch` 按**语义**找「资料」（问答/综述）。

---

## 6. API 端点（`src/app/api/agent/knowledge/*`）

遵循现有约定：`auth()` + `apiError` 信封 + `[id]` 路由 `isUuid` + 写入限流 scope `knowledge`（30 次/分/用户，带 `Retry-After`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/agent/knowledge/documents` | 文档列表（分页 / 标题搜索 / status·source 筛选 / 排序；leftJoin 带出来源资产标题）|
| POST | `/api/agent/knowledge/documents` | 新增文档（manual 用提交正文；asset 由服务端回读资产正文）→ 同步摄取 → 返回 `{ id, status, chunkCount }` |
| POST | `/api/agent/knowledge/documents/upload` | **上传文件**新增文档（multipart：`file` 必填 + `title` 可选）→ 解析（anydoc）→ 同步摄取 → 返回同构 `{ id, status, chunkCount }`；`runtime=nodejs`、`maxDuration=60`、限流同 scope `knowledge` |
| DELETE | `/api/agent/knowledge/documents/[id]` | 删除（chunks 经外键级联清理）|
| POST | `/api/agent/knowledge/documents/[id]/retry` | 重新摄取（失败文档重试）|
| GET | `/api/agent/knowledge/documents/[id]` | 文档详情（**预览用**）：元信息 + 入库原文 + 片段列表（**不 select embedding 列**）→ `{ document, chunks }`；越权/不存在同返 404 |
| POST | `/api/agent/knowledge/search` | **检索测试**：`{ query(1..500), topK?(1..8 默认 5) }` → `{ results }`；复用 `searchKnowledgeByText`（同链路同阈值）；限流同 scope `knowledge`；零计费 |

客户端契约在 `src/features/knowledge/api/{types,queries,mutations}.ts`（`knowledgeKeys` 查询键工厂，mutation 成功失效列表）。

---

## 7. 前端

- `/dashboard/knowledge`：文档 data-table（标题/来源/状态/片段数/时间；行操作：预览/重新摄取/删除）。组件在 `src/features/knowledge/components/`（`add-document-dialog` 支持**三来源 tab**：粘贴文本 / 从资产导入 / **上传文件**；资产选择复用 `assetsQueryOptions`，文件上传复用本地化后的 [`FileUploader`](../src/components/file-uploader.tsx)；`knowledge-tables/*`、`knowledge-listing`）。
- **预览弹窗**（`knowledge-preview-dialog`）：头部元信息（状态/来源/片段数/更新时间）+「全文 / 片段」Tab；数据来自 `GET /documents/[id]`（`staleTime=0` 每次打开重拉；只读快照，不做原文编辑）；processing/failed 文档给出状态提示，片段 Tab 按 `chunkIndex` 升序展示（序号 + 字符数 + 内容）。
- **检索测试入口**（`knowledge-search-panel`，页面头部与「新增文档」同栏）：输入 query + topK → 结果列表（相似度 3 位小数 + 可视化条 + 文档标题 + 片段截断可展开）；空结果给「未命中」引导文案，429 给中文提示。
- **文件上传 tab**：`FileUploader`（`accept=KNOWLEDGE_FILE_ACCEPT`、`maxFiles=1`、`maxSize=10MB`）+ 可选标题；走 `uploadKnowledgeDocumentMutation`（multipart，[`apiClient`](../src/lib/api-client.ts) 对 FormData 自动省略 Content-Type 以保留 boundary）；`add-document-dialog` 用 `hasFile` 字段做「未选文件」校验，离开 tab 清空已选文件。`FileUploader` 对**非图片文件不建 object-URL 预览**（PDF/office blob 无法被 `<Image>` 渲染会破图），改用类型图标。
- 导航：`src/config/nav-config.ts` 「概览」组「知识库」→ `/dashboard/knowledge`。

---

## 8. 关键约束

- **维度一致性**：向量列 `VECTOR_DIM`、`EMBEDDING_DIM`、embed 的 `dimensions` 三者必须一致；改维度需重建列+HNSW 索引并对历史数据重嵌。
- **HTML 入库先抽正文**：html 资产经 `htmlToText` 去标签，不把 markup/CSS/JS 向量化。
- **失败即清理**：摄取失败清空半截片段并置 `failed`，避免残留片段被检索。
- **迁移**：`bunx drizzle-kit generate` + 手动补 HNSW 索引 SQL + `bun scripts/db-apply-sql.ts`（RDS 下 `db:push` 静默失败）。

---

## 9. 明确延后（未实现）

扫描件/图片型 PDF 的 OCR（anydoc 报 `needsOcr` 即拒，未启用其 `ocr:'hosted'` 联网 OCR）、重排（rerank）、多知识库分组、chunk 参数调优 UI、异步摄取（当前同步 + 100KB 上限）、原始文件存 OSS 与下载、多文件批量上传、非 UTF-8 编码探测、Markdown 标题感知切分。
