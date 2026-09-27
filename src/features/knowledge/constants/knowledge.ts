/**
 * RAG 知识库常量：来源/状态枚举、切分与上限参数、检索默认值。
 * 服务端（摄取、检索）与客户端（表格、对话框）共用同一来源，避免魔法数字散落。
 */

/** 文档来源：手动粘贴文本 / 从文本资产导入 / 上传文件解析 */
export const KNOWLEDGE_SOURCE_VALUES = ['manual', 'asset', 'file'] as const;

export type KnowledgeSource = (typeof KNOWLEDGE_SOURCE_VALUES)[number];

export const KNOWLEDGE_SOURCE_LABELS: Record<KnowledgeSource, string> = {
  manual: '手动录入',
  asset: '资产导入',
  file: '文件上传'
};

/** 摄取状态：写入即 processing，向量化完成后 ready，异常置 failed（可重试） */
export const KNOWLEDGE_STATUS_VALUES = ['processing', 'ready', 'failed'] as const;

export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS_VALUES)[number];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  processing: '处理中',
  ready: '可检索',
  failed: '失败'
};

/** 可导入知识库的资产类型（仅文本类；image/design 无正文语义） */
export const IMPORTABLE_ASSET_KINDS = 'markdown,html';

// --- 切分参数（按字符数近似，中文场景够用） --------------------------------

/** 单片段目标长度（PRD：约 500–800 字） */
export const CHUNK_TARGET_CHARS = 700;

/** 相邻片段重叠长度（保留跨片段上下文） */
export const CHUNK_OVERLAP_CHARS = 80;

/** 单个原子单元（句子）硬切上限：超长句按字符强切，避免单片段爆长 */
export const CHUNK_UNIT_MAX_CHARS = 300;

// --- 单文档防御上限 -------------------------------------------------------

/** 单文档正文字节上限（超出则直接拒绝入库，避免函数超时） */
export const MAX_DOCUMENT_BYTES = 100 * 1024;

/** 上传文件的原始字节上限（multipart 端点与前端 FileUploader 共用；提取文本仍受 MAX_DOCUMENT_BYTES 约束） */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

/** 导入资产的原始正文字节上限（html 去标签前的防御线） */
export const MAX_SOURCE_BYTES = 1024 * 1024;

/** 单文档最大片段数（切分结果超限说明文本异常，拒绝摄取） */
export const MAX_CHUNKS_PER_DOCUMENT = 200;

// --- 检索参数 -------------------------------------------------------------

/** knowledgeSearch 默认返回条数 */
export const DEFAULT_SEARCH_TOP_K = 5;

/** knowledgeSearch 返回条数上限 */
export const MAX_SEARCH_TOP_K = 8;

/**
 * 检索相似度阈值（score = 1 - cosine 距离）：低于此值视为未命中，避免无关片段污染上下文。
 * 2026-09 真实语料标定（text-embedding-v4）：无关查询的噪声带顶部 ~0.36，真实语义查询
 * 命中相关文档 0.56+（原文回查 0.67~0.95）；取两带分界 0.45（宁漏召不误导）。
 * 语料规模或 embedding 模型变化时需重新标定。
 */
export const SEARCH_MIN_SCORE = 0.45;
