import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  sql,
  type SQL
} from 'drizzle-orm';
import { cache } from 'react';
import { getDb } from '@/lib/db';
import { assets, conversations, messages } from '@/lib/db/schema';
import { assetObjectKey, getOssServerClient, putObject } from '@/lib/oss';
import { DEFAULT_CONVERSATION_TITLE, buildConversationTitle } from '../constants/conversation';
import type {
  Asset,
  AssetDetail,
  AssetFilters,
  AssetSearchFilters,
  AssetSearchHit,
  AssetsResponse,
  AssetKind,
  ChatMessage,
  Conversation,
  ConversationsResponse
} from './types';

/**
 * Agent 模块数据访问层（server-only）。
 * 客户端查询（queries.ts）走 /api/agent/* Route Handlers，不直接引用本文件。
 */

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    activeSkillId: row.activeSkillId ?? null,
    activeStreamId: row.activeStreamId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as ChatMessage['role'],
    parts: row.parts as UIMessage['parts'],
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sourceAssetId: row.sourceAssetId ?? null,
    source: row.source as Asset['source'],
    kind: row.kind as AssetKind,
    title: row.title,
    status: row.status,
    favorite: row.favorite,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    // 列表缩略图/下载均依赖 storageKey（无预览的 design 显示占位，不外露 key 本身）
    hasPreview: row.storageKey !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * 会话列表 + 每会话资产数：列表与分组计数互不依赖，并行查询；
 * 计数只统计仍挂在会话下的资产（conversationId 非空），一次 group by 拿全。
 */
export async function listConversations(userId: string): Promise<ConversationsResponse> {
  const db = getDb();
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(50),
    db
      .select({ conversationId: assets.conversationId, total: count() })
      .from(assets)
      .where(and(eq(assets.userId, userId), isNotNull(assets.conversationId)))
      .groupBy(assets.conversationId)
  ]);

  const assetCounts: Record<string, number> = {};
  for (const row of countRows) {
    if (row.conversationId) assetCounts[row.conversationId] = Number(row.total);
  }
  return { conversations: rows.map(toConversation), assetCounts };
}

/**
 * 会话归属查询。React.cache 做 per-request 去重：
 * 页面与 listMessages 的归属校验在同请求内只查一次（无请求作用域时退化为不缓存，无副作用）。
 */
export const getConversation = cache(
  async (userId: string, conversationId: string): Promise<Conversation | undefined> => {
    const db = getDb();
    const rows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
      .limit(1);
    return rows[0] ? toConversation(rows[0]) : undefined;
  }
);

export async function createConversation(
  userId: string,
  model: string,
  options?: { activeSkillId?: string | null }
): Promise<Conversation> {
  const db = getDb();
  const rows = await db
    .insert(conversations)
    .values({
      userId,
      model,
      title: DEFAULT_CONVERSATION_TITLE,
      activeSkillId: options?.activeSkillId ?? null
    })
    .returning();
  return toConversation(rows[0]);
}

export async function updateConversation(
  userId: string,
  conversationId: string,
  patch: { title?: string; model?: string; activeSkillId?: string | null }
): Promise<Conversation | undefined> {
  const db = getDb();
  const rows = await db
    .update(conversations)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning();
  return rows[0] ? toConversation(rows[0]) : undefined;
}

export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function touchConversation(conversationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/** 记录会话当前的活跃可恢复流（刷新后据此重连） */
export async function setConversationActiveStream(
  conversationId: string,
  activeStreamId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(conversations)
    .set({ activeStreamId })
    .where(eq(conversations.id, conversationId));
}

/** 仅在引用仍指向同一流时清除（避免误清掉之后启动的新流） */
export async function clearConversationActiveStream(
  conversationId: string,
  activeStreamId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(conversations)
    .set({ activeStreamId: null })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.activeStreamId, activeStreamId))
    )
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/** 会话仍是默认标题时，用首条用户消息生成标题 */
export async function applyAutoTitle(
  userId: string,
  conversation: Conversation,
  userText: string
): Promise<void> {
  if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return;
  const title = buildConversationTitle(userText);
  if (title === DEFAULT_CONVERSATION_TITLE) return;
  await updateConversation(userId, conversation.id, { title });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * 持久化只需要 UIMessage 的结构子集，与 AI SDK 的具体泛型解耦。
 */
export interface PersistedUIMessage {
  id: string;
  role: string;
  parts: unknown[];
  metadata?: unknown;
}

function toMessageRow(conversationId: string, message: PersistedUIMessage) {
  return {
    id: message.id,
    conversationId,
    role: message.role,
    parts: message.parts,
    metadata: (message.metadata as Record<string, unknown> | undefined) ?? null
  };
}

const messageUpsertSet = {
  role: sql`excluded.role`,
  parts: sql`excluded.parts`,
  metadata: sql`excluded.metadata`
};

export async function listMessages(
  userId: string,
  conversationId: string
): Promise<ChatMessage[] | undefined> {
  const conversation = await getConversation(userId, conversationId);
  if (!conversation) return undefined;
  const db = getDb();
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
  return rows.map(toChatMessage);
}

/** 请求开始时先落一条用户消息（upsert，保证中断场景不丢输入） */
export async function saveUserMessage(
  conversationId: string,
  message: PersistedUIMessage
): Promise<void> {
  const db = getDb();
  await db
    .insert(messages)
    .values(toMessageRow(conversationId, message))
    .onConflictDoUpdate({ target: messages.id, set: messageUpsertSet });
}

/**
 * 重试/重新生成场景的定点清理：若目标 user 消息仍是会话内最后一条用户消息，
 * 删除其后残留的 assistant 消息（被取代的失败/半截回答）。
 *
 * 只在新请求开始阶段执行（而非陈旧 onEnd 回调），天然避开历史并发误删问题；
 * 守卫条件保证不会误删其他端更新的新轮次。
 */
export async function cleanupSupersededResponses(
  conversationId: string,
  userMessageId: string
): Promise<void> {
  const db = getDb();
  const latestUserRows = await db
    .select({ id: messages.id, createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, 'user')))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const latestUser = latestUserRows[0];
  if (!latestUser || latestUser.id !== userMessageId) return;

  await db
    .delete(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, 'assistant'),
        gt(messages.createdAt, latestUser.createdAt)
      )
    );
}

/**
 * 停止流时保存客户端的部分快照：只插不覆盖。
 * 服务端取消完成后会以自身版本 upsert（权威版本）；此快照仅防止服务端取消未完成时丢内容。
 */
export async function saveAssistantSnapshot(
  conversationId: string,
  message: PersistedUIMessage
): Promise<void> {
  const db = getDb();
  await db
    .insert(messages)
    .values(toMessageRow(conversationId, message))
    .onConflictDoNothing({ target: messages.id });
}

/**
 * 流结束后落库（按所有权更新，官方 merge 纪律）：
 * - 仅对"本轮新产生"的消息（finalMessages 超出 originalMessages 的尾部 = 本轮 assistant 消息）
 *   执行冲突更新；
 * - 其余已存在的旧消息（客户端视图）一律 onConflictDoNothing，避免用陈旧视图
 *   覆盖服务端较新版本（"Avoid overwriting a newer server-written message with an
 *   older client snapshot"），同时不做任何删除。
 */
export async function syncConversationMessages(
  conversationId: string,
  originalMessages: PersistedUIMessage[],
  finalMessages: PersistedUIMessage[]
): Promise<void> {
  const db = getDb();
  if (finalMessages.length === 0) return;

  // 防线：空 id 消息会在 messages 主键上跨会话冲突（历史事故根因之一），跳过并告警
  const safeFinalMessages = finalMessages.filter((message) => message.id.length > 0);
  if (safeFinalMessages.length !== finalMessages.length) {
    console.error('[agent] detected messages with empty id, skipped persistence');
  }
  if (safeFinalMessages.length === 0) return;

  const originalIds = new Set(originalMessages.map((message) => message.id));
  const existingMessages = safeFinalMessages.filter((message) => originalIds.has(message.id));
  const ownedMessages = safeFinalMessages.filter((message) => !originalIds.has(message.id));

  if (existingMessages.length > 0) {
    await db
      .insert(messages)
      .values(existingMessages.map((message) => toMessageRow(conversationId, message)))
      .onConflictDoNothing({ target: messages.id });
  }
  if (ownedMessages.length > 0) {
    await db
      .insert(messages)
      .values(ownedMessages.map((message) => toMessageRow(conversationId, message)))
      .onConflictDoUpdate({ target: messages.id, set: messageUpsertSet });
  }
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function createAsset(params: {
  userId: string;
  conversationId: string;
  title: string;
  kind: AssetKind;
  content: string;
}): Promise<{ id: string; sizeBytes: number }> {
  const db = getDb();
  const sizeBytes = Buffer.byteLength(params.content, 'utf8');
  const mime = params.kind === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8';
  const rows = await db
    .insert(assets)
    .values({
      userId: params.userId,
      conversationId: params.conversationId,
      source: 'agent',
      title: params.title,
      kind: params.kind,
      content: params.content,
      mime,
      sizeBytes,
      status: 'ready'
    })
    .returning({ id: assets.id });
  return { id: rows[0].id, sizeBytes };
}

/**
 * 图片资产：应用层预生成 assetId → 转存 OSS → 一次性 insert 全字段
 * （避免「先插后更」的两次写库；prompt 存 content 列可溯源/可重试）。
 */
export async function createImageAsset(params: {
  userId: string;
  /** 归属会话（可空）：聊天内生成传入；资产行「继续修改」直连编辑无会话 */
  conversationId: string | null;
  title: string;
  prompt: string;
  imageBuffer: Buffer;
  mime: string;
  /** 派生来源资产 id（I2I 编辑产物传入源资产；文生图为空） */
  sourceAssetId?: string | null;
}): Promise<{ id: string; sizeBytes: number }> {
  const assetId = randomUUID();
  const storageKey = assetObjectKey(params.userId, assetId, 'png');
  await putObject(storageKey, params.imageBuffer, params.mime);

  const sizeBytes = params.imageBuffer.byteLength;
  const db = getDb();
  await db.insert(assets).values({
    id: assetId,
    userId: params.userId,
    conversationId: params.conversationId,
    sourceAssetId: params.sourceAssetId ?? null,
    source: 'agent',
    title: params.title,
    kind: 'image',
    content: params.prompt,
    storageKey,
    mime: params.mime,
    sizeBytes,
    status: 'ready'
  });
  return { id: assetId, sizeBytes };
}

/**
 * 用户上传图片资产（source='upload'）：与 createImageAsset 同构——预生成 id → 转存 OSS → 一次性 insert。
 * 差异：source='upload'、conversationId=null（上传无归属会话）、content=null（上传图无 prompt）、
 * 扩展名/mime 由真实图片类型决定（png/jpg/webp，非固定 png）。不改动 createImageAsset（Agent 生成路径不受影响）。
 */
export async function createUploadedImageAsset(params: {
  userId: string;
  title: string;
  imageBuffer: Buffer;
  /** 规范 mime（由魔数判定的真实类型得出） */
  mime: string;
  /** OSS 对象扩展名（png/jpg/webp） */
  ext: string;
}): Promise<{ id: string; sizeBytes: number }> {
  const assetId = randomUUID();
  const storageKey = assetObjectKey(params.userId, assetId, params.ext);
  await putObject(storageKey, params.imageBuffer, params.mime);

  const sizeBytes = params.imageBuffer.byteLength;
  const db = getDb();
  await db.insert(assets).values({
    id: assetId,
    userId: params.userId,
    conversationId: null,
    sourceAssetId: null,
    source: 'upload',
    title: params.title,
    kind: 'image',
    content: null,
    storageKey,
    mime: params.mime,
    sizeBytes,
    status: 'ready'
  });
  return { id: assetId, sizeBytes };
}

/**
 * 视频资产：与 createImageAsset 同构——应用层预生成 assetId → 转存 OSS（.mp4）→ 一次性 insert 全字段。
 * prompt 存 content 列（可溯源/可重试）；I2V 派生视频用 sourceAssetId 记录血缘（指向源图片资产）。
 */
export async function createVideoAsset(params: {
  userId: string;
  /** 归属会话（可空）：聊天内生成传入；预留直连端点无会话场景 */
  conversationId: string | null;
  title: string;
  /** 生成 prompt（存 content 列，可溯源，与图片一致） */
  prompt: string;
  videoBuffer: Buffer;
  mime: 'video/mp4';
  /** 派生来源资产 id（I2V 产物指向源图片资产；T2V 为空） */
  sourceAssetId?: string | null;
}): Promise<{ id: string; sizeBytes: number }> {
  const assetId = randomUUID();
  const storageKey = assetObjectKey(params.userId, assetId, 'mp4');
  await putObject(storageKey, params.videoBuffer, params.mime);

  const sizeBytes = params.videoBuffer.byteLength;
  const db = getDb();
  await db.insert(assets).values({
    id: assetId,
    userId: params.userId,
    conversationId: params.conversationId,
    sourceAssetId: params.sourceAssetId ?? null,
    source: 'agent',
    title: params.title,
    kind: 'video',
    content: params.prompt,
    storageKey,
    mime: params.mime,
    sizeBytes,
    status: 'ready'
  });
  return { id: assetId, sizeBytes };
}

/**
 * 设计画布资产：文档 JSON 存 content 列，导出 PNG 预览存 OSS（storageKey）。
 * 参照 createImageAsset 的「预生成 id → 转存 OSS → 一次性 insert 全字段」。
 * previewPng 可空（纯图形文档首次保存可不带预览）；mime 固定 application/json（描述 content 列）。
 *
 * **sizeBytes 口径与 image/video 一致 = 下载产物体积**（design 下载走预览 PNG，非文档 JSON），
 * 避免列表显示几百 B 而下载文件上 MB 的观感矛盾；无预览时回退文档 JSON 字节。
 */
export async function createDesignAsset(params: {
  userId: string;
  title: string;
  /** 文档 JSON 字符串（已序列化） */
  document: string;
  /** 导出 PNG 预览字节（可空） */
  previewPng?: Buffer | null;
}): Promise<{ id: string; sizeBytes: number }> {
  const assetId = randomUUID();
  const previewPng =
    params.previewPng && params.previewPng.byteLength > 0 ? params.previewPng : null;
  const sizeBytes = previewPng ? previewPng.byteLength : Buffer.byteLength(params.document, 'utf8');

  let storageKey: string | null = null;
  if (previewPng) {
    storageKey = assetObjectKey(params.userId, assetId, 'png');
    await putObject(storageKey, previewPng, 'image/png');
  }

  const db = getDb();
  await db.insert(assets).values({
    id: assetId,
    userId: params.userId,
    conversationId: null,
    source: 'agent',
    title: params.title,
    kind: 'design',
    content: params.document,
    storageKey,
    mime: 'application/json',
    sizeBytes,
    status: 'ready'
  });
  return { id: assetId, sizeBytes };
}

/**
 * 按所有权更新 design 资产：content/title 按存在性更新，重传 PNG 覆盖同一 storageKey。
 * 仅对 kind='design' 且归属当前用户的行生效；返回是否命中更新。
 * sizeBytes 仅在**本次重传了预览**时更新（口径 = 下载产物体积）；未重传时 storageKey 仍指旧 PNG，
 * 旧值更贴近真实下载体积，故不动（文档 JSON 变化不影响该口径）。
 */
export async function updateDesignAsset(params: {
  userId: string;
  assetId: string;
  title?: string;
  /** 文档 JSON 字符串（已序列化） */
  document?: string;
  previewPng?: Buffer | null;
}): Promise<boolean> {
  const previewPng =
    params.previewPng && params.previewPng.byteLength > 0 ? params.previewPng : null;
  let storageKey: string | null = null;
  if (previewPng) {
    storageKey = assetObjectKey(params.userId, params.assetId, 'png');
    await putObject(storageKey, previewPng, 'image/png');
  }

  const set: Partial<{
    title: string;
    content: string;
    sizeBytes: number;
    storageKey: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (params.title !== undefined) set.title = params.title;
  if (params.document !== undefined) set.content = params.document;
  if (previewPng) set.sizeBytes = previewPng.byteLength;
  if (storageKey) set.storageKey = storageKey;

  const db = getDb();
  const rows = await db
    .update(assets)
    .set(set)
    .where(
      and(
        eq(assets.id, params.assetId),
        eq(assets.userId, params.userId),
        eq(assets.kind, 'design')
      )
    )
    .returning({ id: assets.id });
  return rows.length > 0;
}

function parseAssetOrderBy(sort?: string): SQL {
  if (!sort) return desc(assets.createdAt);
  try {
    const parsed = JSON.parse(sort) as { id?: string; desc?: boolean }[];
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const direction = first?.desc ? desc : asc;
    switch (first?.id) {
      case 'title':
        return direction(assets.title);
      case 'sizeBytes':
        return direction(assets.sizeBytes);
      case 'createdAt':
        return direction(assets.createdAt);
      default:
        return desc(assets.createdAt);
    }
  } catch {
    return desc(assets.createdAt);
  }
}

export async function listAssets(userId: string, filters: AssetFilters): Promise<AssetsResponse> {
  const db = getDb();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));

  const conditions = [eq(assets.userId, userId)];
  if (filters.search) {
    conditions.push(ilike(assets.title, `%${filters.search}%`));
  }
  const kinds = filters.kind
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (kinds && kinds.length > 0) {
    conditions.push(inArray(assets.kind, kinds));
  }
  if (filters.favorite !== undefined) {
    conditions.push(eq(assets.favorite, filters.favorite));
  }
  const where = and(...conditions);

  // count 与分页数据互不依赖，并行执行（async-parallel）
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(assets).where(where),
    db
      .select()
      .from(assets)
      .where(where)
      .orderBy(parseAssetOrderBy(filters.sort))
      .limit(limit)
      .offset((page - 1) * limit)
  ]);

  return {
    assets: rows.map(toAsset),
    total: Number(total),
    page,
    limit
  };
}

/**
 * Agent 工具（findAssets）专用检索：按标题关键词 + 类型过滤，按创建时间倒序取前 N 条。
 * 只选取可引用的元信息列（不读 content / storageKey），保证工具返回不含正文与图片地址。
 */
export async function searchAssets(
  userId: string,
  filters: AssetSearchFilters
): Promise<AssetSearchHit[]> {
  const db = getDb();
  const limit = Math.min(20, Math.max(1, filters.limit ?? 8));

  const conditions = [eq(assets.userId, userId)];
  const query = filters.query?.trim();
  if (query) {
    conditions.push(ilike(assets.title, `%${query}%`));
  }
  if (filters.kind) {
    conditions.push(eq(assets.kind, filters.kind));
  }

  const rows = await db
    .select({
      id: assets.id,
      title: assets.title,
      kind: assets.kind,
      createdAt: assets.createdAt
    })
    .from(assets)
    .where(and(...conditions))
    .orderBy(desc(assets.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    assetId: row.id,
    title: row.title,
    kind: row.kind as AssetKind,
    createdAt: row.createdAt.toISOString()
  }));
}

export async function getAsset(userId: string, assetId: string): Promise<AssetDetail | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;

  // 派生来源标题：仅当存在 sourceAssetId 时额外查询一次（同用户域，已删除/越权同样视为不可见）
  let sourceTitle: string | null = null;
  if (row.sourceAssetId) {
    const parents = await db
      .select({ title: assets.title })
      .from(assets)
      .where(and(eq(assets.id, row.sourceAssetId), eq(assets.userId, userId)))
      .limit(1);
    sourceTitle = parents[0]?.title ?? null;
  }

  // previewUrl 由调用方（详情端点）签发：data access 层不关心签名过期策略
  return {
    ...toAsset(row),
    content: row.content,
    storageKey: row.storageKey,
    previewUrl: null,
    sourceTitle
  };
}

export async function deleteAsset(userId: string, assetId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .returning({ id: assets.id, storageKey: assets.storageKey });
  if (rows.length === 0) return false;

  // OSS 对象顺带删除；失败仅告警不阻塞（DB 行已删，残留对象无访问路径）
  const storageKey = rows[0].storageKey;
  if (storageKey) {
    try {
      await getOssServerClient().delete(storageKey);
    } catch (error) {
      console.warn('[agent] failed to delete OSS object:', { storageKey, error });
    }
  }
  return true;
}

/** 收藏/取消收藏（任意 kind）：按所有权更新，返回是否命中 */
export async function setAssetFavorite(
  userId: string,
  assetId: string,
  favorite: boolean
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(assets)
    .set({ favorite, updatedAt: new Date() })
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .returning({ id: assets.id });
  return rows.length > 0;
}
