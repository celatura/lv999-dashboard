import type { UIMessage } from 'ai';
import { z } from 'zod';
import { ASPECT_KEYS } from '../constants/image-models';
import { AGENT_TOOL_NAMES, type AgentToolName, type SkillExample } from '../constants/skills';

export interface Conversation {
  id: string;
  title: string;
  model: string;
  /** 会话级技能（专家模式）id：指向 SKILL_REGISTRY；null = 通用（无技能） */
  activeSkillId: string | null;
  /** 正在进行的可恢复流 id（用于刷新后重连与停止）；无活跃流时为 null */
  activeStreamId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: UIMessage['role'];
  parts: UIMessage['parts'];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  /** 会话产出资产数（conversationId → count），供侧边栏 badge 展示；无资产的会话不在表中 */
  assetCounts: Record<string, number>;
}

/** 资产类型枚举值（单一来源：Agent 工具的 Zod enum 与展示元数据均以此为准） */
export const ASSET_KIND_VALUES = ['markdown', 'html', 'image', 'design', 'video'] as const;

export type AssetKind = (typeof ASSET_KIND_VALUES)[number];

/** 资产来源：agent 生成 / 用户上传 */
export type AssetSource = 'agent' | 'upload';

export interface Asset {
  id: string;
  /** 来源会话（可空）：上传资产无会话；会话删除后置空，资产保留 */
  conversationId: string | null;
  /** 派生来源资产 id（图片编辑 I2I 产物指向被编辑的源资产；源删除后置空） */
  sourceAssetId: string | null;
  source: AssetSource;
  kind: AssetKind;
  title: string;
  status: string;
  /** 用户收藏标记（任意 kind 可收藏） */
  favorite: boolean;
  mime: string | null;
  sizeBytes: number | null;
  /**
   * 是否已有二进制预览/产物（storageKey 非空）。
   * AI 整版产出的 design 首轮无预览（预览由画布保存时客户端导出），列表据此显示占位。
   */
  hasPreview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDetail extends Asset {
  content: string | null;
  /** OSS 对象 key（图片等二进制资产非空；详情端点据此签发 previewUrl） */
  storageKey: string | null;
  /** 图片资产签名预览 URL（3600s 有效，刷新后重新签发）；非图片或未签发为 null */
  previewUrl: string | null;
  /** 源资产标题（仅当 sourceAssetId 存在且源资产仍可访问时非空，供「基于《xxx》修改」展示） */
  sourceTitle: string | null;
}

export interface AssetFilters {
  page?: number;
  limit?: number;
  search?: string;
  /** 逗号分隔的 kind 列表，如 "markdown,html" */
  kind?: string;
  /** true 时仅看收藏 */
  favorite?: boolean;
  sort?: string;
}

export interface AssetsResponse {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

/** Agent 工具检索资产库的过滤条件（findAssets） */
export interface AssetSearchFilters {
  /** 标题模糊关键词（可空） */
  query?: string;
  /** 限定资产类型（可空） */
  kind?: AssetKind;
  /** 返回条数上限（1..20，默认 8） */
  limit?: number;
}

/** 检索命中项：仅元信息，不含正文与签名 URL（供模型引用，避免体积膨胀与越权外泄） */
export interface AssetSearchHit {
  assetId: string;
  title: string;
  kind: AssetKind;
  createdAt: string;
}

export interface CreateConversationPayload {
  model: string;
  /** 创建时即激活的技能（可空；新建会话「带技能开始」） */
  activeSkillId?: string | null;
}

export interface UpdateConversationPayload {
  title?: string;
  model?: string;
  /** 切换技能；null = 清除回「通用」 */
  activeSkillId?: string | null;
}

// ---------------------------------------------------------------------------
// 资产写操作请求体（Route Handler 校验用，与设计画布 types.ts 的 schema 同模式）
// ---------------------------------------------------------------------------

/** 图片「继续修改」（直连 I2I）请求体 */
export const editImageRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
  aspect: z.enum(ASPECT_KEYS).optional()
});

export type EditImageRequest = z.infer<typeof editImageRequestSchema>;

/**
 * 图片「AI 生成」（直连 T2I，设计画布内使用）请求体。
 * title 可空：缺省由服务端按 prompt 截断生成（与聊天内工具由模型给标题不同）。
 */
export const generateImageRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  aspect: z.enum(ASPECT_KEYS).optional(),
  title: z.string().min(1).max(100).optional()
});

export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;

/** 收藏/取消收藏请求体 */
export const favoriteRequestSchema = z.object({
  favorite: z.boolean()
});

export type FavoriteRequest = z.infer<typeof favoriteRequestSchema>;

/** 批量删除请求体（单次上限 100 个） */
export const batchDeleteRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
});

export type BatchDeleteRequest = z.infer<typeof batchDeleteRequestSchema>;

// ---------------------------------------------------------------------------
// 技能系统 2.0（用户自定义技能）
// ---------------------------------------------------------------------------

export type { AgentToolName, SkillExample };

/**
 * 技能列表项：预置（source='builtin'，只读）与用户自定义（source='custom'，可编辑/删除）
 * 合并同构，供会话选择器与技能管理页共用一份查询。字段与 SkillRegistryEntry 对齐，
 * 另加 source / updatedAt 供 UI 区分与展示。
 */
export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  /** builtin = 代码内预置（只读）；custom = 用户自定义（可编辑/删除） */
  source: 'builtin' | 'custom';
  instructions: string;
  placeholder: string | null;
  /** 工具白名单；null = 全量 */
  tools: AgentToolName[] | null;
  /** few-shot 示例；[] = 无 */
  examples: SkillExample[];
  /** 自定义技能的更新时间；预置为 null（无 DB 行） */
  updatedAt: string | null;
}

export interface SkillsResponse {
  skills: SkillListItem[];
}

export const skillExampleSchema = z.object({
  input: z.string().trim().min(1, '示例输入不能为空').max(300, '示例输入不超过 300 字'),
  output: z.string().trim().min(1, '示例输出不能为空').max(500, '示例输出不超过 500 字')
});

/**
 * 创建/更新自定义技能的请求体校验（Route Handler 用）。
 * 约束见 docs/agent.md §5.1：instructions ≤8000 字（控 system token）、tools 元素必须 ∈ AGENT_TOOL_NAMES
 * （防非法工具名进入 toolFactories 查找）、examples ≤2 条。tools null/缺省 = 全量。
 */
export const skillMutationSchema = z.object({
  name: z.string().trim().min(1, '技能名称不能为空').max(50, '技能名称不超过 50 字'),
  description: z.string().trim().min(1, '一句话描述不能为空').max(200, '描述不超过 200 字'),
  instructions: z.string().trim().min(1, '专家指令不能为空').max(8000, '专家指令不超过 8000 字'),
  placeholder: z.string().trim().max(100, '输入框引导语不超过 100 字').nullish(),
  tools: z.array(z.enum(AGENT_TOOL_NAMES)).max(9, '工具最多 9 个').nullish(),
  examples: z.array(skillExampleSchema).max(2, '示例最多 2 条').default([])
});

export type SkillMutationPayload = z.infer<typeof skillMutationSchema>;
