import {
  boolean,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid
} from 'drizzle-orm/pg-core';
import { vector1024 } from './vector';
// type-only：仅为 jsonb 列标注类型（运行时被擦除，drizzle-kit 无需解析该路径，无循环 import）
import type { AgentToolName, SkillExample } from '../../features/agent/constants/skills';

/**
 * Agent 创作模块数据表
 *
 * - conversations: 会话（含模型选择与会话级技能）
 * - messages: 会话消息（parts 与 AI SDK 的 UIMessage.parts 结构对齐，原样存储）
 * - assets: 用户资产（Agent 生成 source='agent' / 用户上传 source='upload'）；
 *   文本内容存 content 列，二进制走 OSS 只存 storage_key；
 *   会话删除时 conversationId 置空（SET NULL）、资产保留；
 *   图片编辑（I2I）产出的新资产通过 sourceAssetId 指向源资产（源删除时置空）
 * - skills: 用户自定义技能（技能系统 2.0，用户私有）；与代码内预置技能同构，
 *   会话 active_skill_id 存预置 key（字符串）或自定义技能 uuid，解析时 isUuid 分流
 *
 * RAG 知识库（语义检索增强）
 * - knowledge_documents: 知识库文档（手动粘贴 source='manual' / 从文本资产导入 source='asset'）；
 *   原始全文存 content 列（供重嵌与展示），摄取状态 status: processing → ready / failed
 * - knowledge_chunks: 文档切分片段 + 向量（pgvector）；文档删除时级联删除（CASCADE）
 *
 * Credits 消耗系统（成本管控底座）
 * - credits_accounts: 每用户一行余额（懒创建，无记录视为 0；balance 可为负 = 单次透支）
 * - credit_ledger: 流水（只增不改，审计 + 前端展示）；delta 正=grant 负=消耗，balanceAfter 为本笔后余额快照
 */

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  model: text('model').notNull().default('deepseek-flash'),
  /** 会话级技能（专家模式）id：指向代码内技能注册表；null = 通用（无技能） */
  activeSkillId: text('active_skill_id'),
  /** 正在进行的可恢复流 id（resumable-stream）；无活跃流时为 null */
  activeStreamId: text('active_stream_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    parts: jsonb('parts').$type<unknown[]>().notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('messages_conversation_created_idx').on(table.conversationId, table.createdAt)]
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 来源会话（可空）：上传资产无会话；会话删除时置空（SET NULL），资产不随会话删除 */
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null'
    }),
    /** 派生来源资产（可空）：图片编辑（I2I）产出的新资产指向被编辑的源资产；源资产删除时置空（SET NULL） */
    sourceAssetId: uuid('source_asset_id').references((): AnyPgColumn => assets.id, {
      onDelete: 'set null'
    }),
    userId: text('user_id').notNull(),
    /** 资产来源：'agent'（生成）/ 'upload'（导入） */
    source: text('source').notNull().default('agent'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('ready'),
    /** 用户收藏标记（任意 kind 可收藏；列表支持「仅看收藏」筛选） */
    favorite: boolean('favorite').notNull().default(false),
    content: text('content'),
    storageKey: text('storage_key'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('assets_user_created_idx').on(table.userId, table.createdAt),
    index('assets_conversation_idx').on(table.conversationId)
  ]
);

/**
 * 用户自定义技能（技能系统 2.0）：与代码内预置技能（SkillRegistryEntry）同构，
 * 用户私有（按 userId 隔离）。会话 active_skill_id 引用其 uuid；解析映射为
 * SkillRegistryEntry 后复用 buildAgent 的指令注入与工具白名单过滤（零重复实现）。
 * tools 为 null = 全量（与预置技能未声明 tools 同语义）；examples null/空 = 无示例。
 */
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    instructions: text('instructions').notNull(),
    placeholder: text('placeholder'),
    /** 工具白名单；null = 全量（与预置技能 tools 未声明同语义） */
    tools: jsonb('tools').$type<AgentToolName[] | null>(),
    /** few-shot 示例（0-2 条）；null/空 = 无 */
    examples: jsonb('examples').$type<SkillExample[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('skills_user_created_idx').on(table.userId, table.createdAt)]
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    /** 文档来源：'manual'（手动粘贴文本）/ 'asset'（从文本资产导入） */
    source: text('source').notNull(),
    /** 导入来源资产（source='asset' 时非空）；资产删除后置空（SET NULL），文档保留 */
    sourceAssetId: uuid('source_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /** 原始全文：供重嵌与展示，不随切分丢失 */
    content: text('content').notNull(),
    /** 摄取状态：'processing' / 'ready' / 'failed' */
    status: text('status').notNull().default('processing'),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('knowledge_documents_user_created_idx').on(table.userId, table.createdAt)]
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    /** 冗余归属列：检索按用户过滤时无需 join 文档表 */
    userId: text('user_id').notNull(),
    /** 文档内序号（从 0 开始） */
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector1024('embedding').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('knowledge_chunks_user_idx').on(table.userId)]
);
// HNSW 向量索引（drizzle-kit 不生成）由迁移 SQL 手动追加：
// CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
//   ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

/**
 * Credits 账户（每用户一行，懒创建）。
 * 无该 user 行时视为 balance=0；首次 grant 或首次扣费时 upsert 建行。
 * balance 允许为负：checkBalance 判据为 balance>0，已 grant 账号单次调用可透支（见 docs/credits.md §10）。
 */
export const creditsAccounts = pgTable('credits_accounts', {
  userId: text('user_id').primaryKey(),
  balance: integer('balance').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * Credits 流水（只增不改）：审计 + 前端展示。
 * delta 正=grant、负=消耗；balanceAfter 为本笔后余额快照（免回算）；
 * kind: grant/chat/image/video/knowledge；meta 记计量明细（tokens/张/分辨率·秒等）。
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    kind: text('kind').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('credit_ledger_user_created_idx').on(table.userId, table.createdAt)]
);
