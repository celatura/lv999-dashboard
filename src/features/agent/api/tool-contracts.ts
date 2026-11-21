import { tool, type InferUITools, type UIMessage } from 'ai';
import { z } from 'zod';
import { LAYOUT_KEYS } from '@/features/design/constants/layouts';
import { ASSET_KIND_VALUES } from '../constants/asset-kinds';
import { ASPECT_KEYS } from '../constants/image-models';
import { VIDEO_ASPECT_KEYS } from '../constants/video-models';

/**
 * Agent 工具契约（客户端安全）——工具的 description / inputSchema / outputSchema 单一来源。
 *
 * 为什么独立成文件：
 * - 服务端工厂（agent.ts）与历史消息校验（agentValidationTools）共用同一份 schema，避免各写一遍漂移；
 * - 客户端消息类型经 `InferUITools<typeof agentToolContracts>` 推导工具 part 的 input/output，
 *   工具字段改名会直接成为编译错误，渲染层不再手写 ToolPart 接口或双重断言；
 * - `outputSchema` 让 validateUIMessages 能校验历史 tool output（含旧消息），
 *   输出结构漂移会在请求入口 400，而不是在 UI 里读到 undefined。
 *
 * 本文件不得 import 服务端依赖（DB / OSS / Redis / service），保持客户端类型图安全。
 */

// ---------------------------------------------------------------------------
// createAsset / editAsset（文本资产）
// ---------------------------------------------------------------------------

export const CREATE_ASSET_DESCRIPTION =
  '把一份完整作品保存为结构化资产。Markdown 文章/文案用 kind=markdown；完整 HTML 网页用 kind=html（必须是可以直接打开运行的完整文档，样式与脚本内联）。';

export const createAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  kind: z.enum(['markdown', 'html']).describe('资产类型'),
  content: z.string().min(1).describe('资产完整内容')
});

export const EDIT_ASSET_DESCRIPTION =
  '对已有文本资产（markdown / html）做精确的局部编辑：按 old_string → new_string 原文替换，assetId 保持不变。小改（改标题、换措辞、调段落、删片段）优先用本工具，不要整篇重写；整篇改写或扩展成新作品时才用 createAsset。old_string 必须与正文逐字一致（含空格换行），默认要求唯一命中，多处相同文本用 replace_all。';

export const editAssetInputSchema = z.object({
  assetId: z
    .uuid()
    .describe(
      '要编辑的文本资产 id（markdown / html；来自 readAsset / findAssets 结果、上文工具返回值或消息中的 [引用资产] 块）'
    ),
  old_string: z
    .string()
    .min(1)
    .describe('要替换的原文片段：逐字复制（含空格与换行），带 3-5 行前后文确保唯一命中'),
  new_string: z.string().describe('替换后的文本（空字符串 = 删除该片段）'),
  replace_all: z
    .boolean()
    .optional()
    .describe('替换全部命中（默认 false；false 时 old_string 必须在正文中恰好出现一次）'),
  title: z.string().min(1).max(100).optional().describe('可选：编辑后的新资产标题')
});

/** createAsset / editAsset 的输出（结构对齐，渲染层复用同一资产卡片） */
export const textAssetOutputSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  kind: z.enum(['markdown', 'html']),
  sizeBytes: z.number()
});

// ---------------------------------------------------------------------------
// 图片工具
// ---------------------------------------------------------------------------

const aspectFieldSchema = z
  .enum(ASPECT_KEYS)
  .optional()
  .describe(
    '可选：输出比例。竖版小红书封面用 "3:4"，方形 "1:1"，横版 "16:9" 等；不传由模型自动推荐分辨率'
  );

export const CREATE_IMAGE_ASSET_DESCRIPTION =
  '用文生图模型生成一张图片并保存为图片资产。适合封面、海报、配图、插画等场景。prompt 必须完整自包含地描述画面（主体、风格、构图、色调、氛围），不依赖对话上下文；画面中需要出现文字（如标题）时，在 prompt 中写明文字内容与位置；需要竖版（如小红书封面）时用 aspect 指定 "3:4"。';

export const createImageAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  prompt: z.string().min(1).max(2000).describe('文生图提示词：完整自包含的画面描述（中文优先）'),
  aspect: aspectFieldSchema
});

export const EDIT_IMAGE_ASSET_DESCRIPTION =
  '在已有图片资产的基础上按用户要求进行图像编辑（图生图），产出新的图片资产。sourceAssetId 必须是真实存在的图片资产 id：来自上文 createImageAsset / editImageAsset 的返回值、findAssets 的检索结果，或用户消息中 [引用资产] 块给出的 id；instruction 描述修改要求（如"背景换成夜晚""改成水墨淡彩风格"）；title 反映修改后的结果。';

export const editImageAssetInputSchema = z.object({
  sourceAssetId: z
    .uuid()
    .describe(
      '被修改的源图片资产 id（来自上文 createImageAsset / editImageAsset 返回值、findAssets 结果或消息中的 [引用资产] 块）'
    ),
  title: z.string().min(1).max(100).describe('修改后新资产的标题'),
  instruction: z
    .string()
    .min(1)
    .max(2000)
    .describe('修改指令：描述如何修改这张图（如"背景换成夜晚""改成水墨淡彩风格"）'),
  aspect: z
    .enum(ASPECT_KEYS)
    .optional()
    .describe('可选：改变输出比例（不传则延续源图构图；需要竖版封面用 "3:4"）')
});

/** createImageAsset / editImageAsset 的输出（edit 额外带 sourceAssetId 血缘） */
export const imageAssetOutputSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  kind: z.literal('image'),
  sizeBytes: z.number(),
  sourceAssetId: z.uuid().optional()
});

// ---------------------------------------------------------------------------
// 视频工具
// ---------------------------------------------------------------------------

const videoAspectFieldSchema = z
  .enum(VIDEO_ASPECT_KEYS)
  .optional()
  .describe('可选：视频宽高比。横版用 "16:9"，竖版短视频用 "9:16"，方形 "1:1"；不传默认 "16:9"');

const videoDurationFieldSchema = z
  .int()
  .min(2)
  .max(10)
  .optional()
  .describe('可选：视频时长（秒，2-10）；不传默认 5 秒');

export const CREATE_VIDEO_ASSET_DESCRIPTION =
  '用文生视频模型生成一段短视频并保存为视频资产。适合产品演示、动态封面、短广告、动画场景。视频生成通常需要 1-5 分钟，耗时远高于图片，调用前先告知用户等待；prompt 必须自包含描述画面（主体、动作、场景、氛围、镜头运动）；一次对话不要生成多个视频（成本高）。';

export const createVideoAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe('文生视频提示词：完整自包含的画面与动作描述（中文优先，含镜头运动）'),
  aspect: videoAspectFieldSchema,
  duration: videoDurationFieldSchema
});

export const CREATE_VIDEO_FROM_IMAGE_ASSET_DESCRIPTION =
  '在已有图片资产的基础上生成动态视频（图生视频），产出新的视频资产。sourceAssetId 必须是真实存在的图片资产 id（来自上文 createImageAsset / findAssets / [引用资产] 块）；prompt 描述希望的画面动作与镜头运动（如“镜头缓慢推进，花瓣随风飘落”）；title 反映结果。视频生成通常需要 1-5 分钟，调用前先告知用户等待。';

export const createVideoFromImageAssetInputSchema = z.object({
  sourceAssetId: z
    .uuid()
    .describe(
      '作为首帧的源图片资产 id（来自上文 createImageAsset / findAssets 结果或消息中的 [引用资产] 块）'
    ),
  title: z.string().min(1).max(100).describe('新视频资产的标题'),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe('画面动作与镜头运动描述（如“镜头缓慢推进，花瓣随风飘落”）'),
  aspect: videoAspectFieldSchema,
  duration: videoDurationFieldSchema
});

/** createVideoAsset / createVideoFromImageAsset 的输出（I2V 额外带 sourceAssetId 血缘） */
export const videoAssetOutputSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  kind: z.literal('video'),
  sizeBytes: z.number(),
  sourceAssetId: z.uuid().optional()
});

// ---------------------------------------------------------------------------
// composeDesign（整版设计）
// ---------------------------------------------------------------------------

export const COMPOSE_DESIGN_DESCRIPTION =
  '一句话产出「整版设计」（封面 / 海报 / 头图）：内部先文生图，再按版式模板把主图与标题 / 副标题排好版，产出可在设计画布继续编辑的 design 资产（文字为可编辑对象，非烧录到图里）。用户要「做一张…封面，标题是…」这类图文整版需求时用本工具；只要一张图时用 createImageAsset。imagePrompt 只描述画面（不要要求在图里写标题文字）；调用前先想好版式与文案；一次对话不要多次调用。';

export const composeDesignInputSchema = z.object({
  title: z.string().min(1).max(100).describe('设计资产标题'),
  imagePrompt: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      '主图文生图提示词：完整自包含的画面描述（中文优先，主体/风格/构图/色调/氛围）。不要要求画面里出现标题文字，文字由版式排上去'
    ),
  heading: z.string().max(60).optional().describe('可选：主标题文字（排入版面）；不传则用 title'),
  subheading: z.string().max(120).optional().describe('可选：副标题 / 一句话说明；不需要时省略'),
  layout: z
    .enum(LAYOUT_KEYS)
    .describe(
      '版式："top-image" 上图下文（封面常用）；"full-image-bar" 全图 + 底部半透明标题条（图为主视觉）；"left-image" 左图右文（横版头图，竖版自动退化为上图下文）'
    ),
  aspect: z
    .enum(ASPECT_KEYS)
    .optional()
    .describe('可选：画布比例。竖版小红书封面 "3:4"、横版头图 "16:9"、方形 "1:1"；不传默认 "3:4"')
});

/** composeDesign 输出：design 资产 + 作为主图沉淀的 image 资产 id */
export const designAssetOutputSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  kind: z.literal('design'),
  sizeBytes: z.number(),
  imageAssetId: z.uuid()
});

// ---------------------------------------------------------------------------
// 资产检索 / 读取
// ---------------------------------------------------------------------------

export const FIND_ASSETS_DESCRIPTION =
  '检索当前用户的资产库（「我的资产」），按标题关键词与类型查找可复用的已有作品，返回候选的元信息（assetId / title / kind / createdAt），不返回正文与图片。当用户提到"我之前那张""这篇文案""上次的封面"等指向已有作品时，先用它确认 assetId：文本资产接着用 readAsset 取正文，图片资产接着用 editImageAsset 修改。消息中已有 [引用资产] 块时不需要调用本工具。';

export const findAssetsInputSchema = z.object({
  query: z
    .string()
    .max(100)
    .optional()
    .describe('标题关键词（模糊匹配），如"秋天""开学文案"；不确定时可省略以列出最近资产'),
  kind: z
    .enum(ASSET_KIND_VALUES)
    .optional()
    .describe('限定资产类型：markdown / html / image / design / video；不确定时可省略'),
  limit: z.int().min(1).max(20).optional().describe('返回条数上限，默认 8')
});

const assetSearchHitSchema = z.object({
  assetId: z.uuid(),
  title: z.string(),
  kind: z.enum(ASSET_KIND_VALUES),
  createdAt: z.string()
});

export const findAssetsOutputSchema = z.object({
  assets: z.array(assetSearchHitSchema)
});

export const READ_ASSET_DESCRIPTION =
  '读取指定资产的可用内容，用于"基于它再创作"（改写、扩展、总结、写配套文案等）。markdown / html 返回正文 content；image / video 返回其生成提示词 prompt（不返回图像/视频本身，要改图请用 editImageAsset）；design 为结构化数据，不支持读取正文。assetId 必须来自 findAssets 结果、上文工具返回值或消息中的 [引用资产] 块。';

export const readAssetInputSchema = z.object({
  assetId: z.uuid().describe('要读取的资产 id（必须归属当前用户）')
});

export const readAssetOutputSchema = z.union([
  z.object({
    kind: z.enum(['markdown', 'html']),
    title: z.string(),
    content: z.string(),
    hint: z.string()
  }),
  z.object({
    kind: z.literal('image'),
    title: z.string(),
    prompt: z.string(),
    hint: z.string()
  }),
  z.object({
    kind: z.literal('video'),
    title: z.string(),
    prompt: z.string(),
    hint: z.string()
  }),
  z.object({
    kind: z.literal('design'),
    title: z.string(),
    hint: z.string()
  })
]);

// ---------------------------------------------------------------------------
// knowledgeSearch（RAG）
// ---------------------------------------------------------------------------

export const KNOWLEDGE_SEARCH_DESCRIPTION =
  '在用户的知识库（RAG）中按内容语义检索资料片段，返回 results: [{ documentId, documentTitle, chunkIndex, content, score }]（score 为相似度，越大越相关）。当用户说"我知识库里…""根据我的资料/笔记""基于我沉淀的文档写一版"，或问题需要引用用户自有资料才能作答时使用。只依据返回片段作答并用 documentTitle 标注来源；results 为空表示知识库中没有相关资料，应如实告知。与 findAssets 的区别：findAssets 按标题关键词找"作品"（用于复用/改写）；knowledgeSearch 按语义找"资料"（用于问答/综述）。';

export const knowledgeSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('检索问句：用自然语言描述要找的内容（包含关键概念词效果更好）'),
  topK: z.int().min(1).max(8).optional().describe('返回片段数上限，默认 5')
});

export const knowledgeSearchOutputSchema = z.object({
  results: z.array(
    z.object({
      documentId: z.string(),
      documentTitle: z.string(),
      chunkIndex: z.number(),
      content: z.string(),
      score: z.number()
    })
  ),
  hint: z.string()
});

// ---------------------------------------------------------------------------
// askUser（客户端工具，无 execute）
// ---------------------------------------------------------------------------

export const ASK_USER_DESCRIPTION =
  '向用户提出 1-3 个澄清问题并等待回答（客户端会弹出选项卡，用户也可自行输入）。当关键创作参数缺失或有歧义、且显著影响产出结果时使用（如图片比例/风格、封面标题文案、视频方向/时长）。一次对话最多提问一轮；能从上下文推断或用户已明确指定时不要提问。';

export const askUserInputSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(200).describe('要问用户的问题（简短明确）'),
        choices: z
          .array(z.string().min(1).max(40))
          .min(2)
          .max(4)
          .describe('2-4 个简短、互斥的回答选项（用户也可自行输入其他答案）')
      })
    )
    .min(1)
    .max(3)
    .describe('要问的问题列表')
});

export const askUserOutputSchema = z
  .array(
    z.object({
      question: z.string(),
      answer: z.string()
    })
  )
  .describe('用户对每个问题的回答');

// ---------------------------------------------------------------------------
// loadSkill（按需加载技能）
// ---------------------------------------------------------------------------

export const LOAD_SKILL_DESCRIPTION =
  '加载一个专家技能（工作流/风格包）的完整指令。技能名称必须来自 system 中「可用技能」列表；当用户任务明显匹配某技能时，先加载再执行。若本会话历史中已加载过同一技能，可直接沿用，不必重复调用。加载后本次回复内按该技能的指令与工具边界工作；不要凭空假设技能内容。';

export const loadSkillInputSchema = z.object({
  name: z.string().min(1).max(50).describe('技能名称（必须与「可用技能」列表中的名称完全一致）')
});

export const loadSkillOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  instructions: z.string()
});

// ---------------------------------------------------------------------------
// 全量工具契约（历史校验 + UI 类型推导的单一来源）
// ---------------------------------------------------------------------------

/**
 * 服务端校验历史消息使用（无需 execute，与 Agent 内工具共享同一 description / schema）。
 * 恒为全量：历史消息可能含任意技能的工具调用，不能随技能边界过滤。
 */
export const agentToolContracts = {
  createAsset: tool({
    description: CREATE_ASSET_DESCRIPTION,
    inputSchema: createAssetInputSchema,
    outputSchema: textAssetOutputSchema
  }),
  editAsset: tool({
    description: EDIT_ASSET_DESCRIPTION,
    inputSchema: editAssetInputSchema,
    outputSchema: textAssetOutputSchema
  }),
  createImageAsset: tool({
    description: CREATE_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createImageAssetInputSchema,
    outputSchema: imageAssetOutputSchema
  }),
  editImageAsset: tool({
    description: EDIT_IMAGE_ASSET_DESCRIPTION,
    inputSchema: editImageAssetInputSchema,
    outputSchema: imageAssetOutputSchema
  }),
  createVideoAsset: tool({
    description: CREATE_VIDEO_ASSET_DESCRIPTION,
    inputSchema: createVideoAssetInputSchema,
    outputSchema: videoAssetOutputSchema
  }),
  createVideoFromImageAsset: tool({
    description: CREATE_VIDEO_FROM_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createVideoFromImageAssetInputSchema,
    outputSchema: videoAssetOutputSchema
  }),
  findAssets: tool({
    description: FIND_ASSETS_DESCRIPTION,
    inputSchema: findAssetsInputSchema,
    outputSchema: findAssetsOutputSchema
  }),
  readAsset: tool({
    description: READ_ASSET_DESCRIPTION,
    inputSchema: readAssetInputSchema,
    outputSchema: readAssetOutputSchema
  }),
  knowledgeSearch: tool({
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    inputSchema: knowledgeSearchInputSchema,
    outputSchema: knowledgeSearchOutputSchema
  }),
  composeDesign: tool({
    description: COMPOSE_DESIGN_DESCRIPTION,
    inputSchema: composeDesignInputSchema,
    outputSchema: designAssetOutputSchema
  }),
  loadSkill: tool({
    description: LOAD_SKILL_DESCRIPTION,
    inputSchema: loadSkillInputSchema,
    outputSchema: loadSkillOutputSchema
  }),
  askUser: tool({
    description: ASK_USER_DESCRIPTION,
    inputSchema: askUserInputSchema,
    outputSchema: askUserOutputSchema
  })
};

/** 工具名 → UI 工具类型（InferUITools 推导 input/output） */
export type AgentChatTools = InferUITools<typeof agentToolContracts>;

/** 与全量契约对齐的 UI 消息类型（供 validateUIMessages 泛型推导 tools 校验类型） */
export type AgentValidationUIMessage = UIMessage<unknown, never, AgentChatTools>;
