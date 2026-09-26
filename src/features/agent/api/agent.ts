import { ToolLoopAgent, isStepCount, tool, type InferUITools, type Tool, type UIMessage } from 'ai';
import { z } from 'zod';
import { DEFAULT_MODEL, isModelKey } from '../constants/models';
import {
  AGENT_TOOL_NAMES,
  getSkill,
  type AgentToolName,
  type SkillExample
} from '../constants/skills';
import { ASPECT_KEYS, ASPECT_PRESETS, type AspectKey } from '../constants/image-models';
import { DEFAULT_I2V_MODEL, VIDEO_ASPECT_KEYS } from '../constants/video-models';
import { resolveModel } from './provider';
import { generateImage } from './image-generation';
import { editImageAssetCore, MAX_EDIT_SOURCE_BYTES } from './image-edit';
import {
  generateVideoAsset,
  VIDEO_RATE_LIMIT,
  VIDEO_RATE_WINDOW_SECONDS
} from './video-generation';
import { checkRateLimit } from './rate-limit';
import {
  createAsset,
  createDesignAsset,
  createImageAsset,
  createVideoAsset,
  getAsset,
  searchAssets
} from './service';
import { ASSET_KIND_VALUES } from './types';
import { searchKnowledgeByText } from '@/features/knowledge/lib/search';
import {
  DEFAULT_LAYOUT_ASPECT,
  LAYOUT_KEYS,
  composeDesignDocument,
  imageRegionRatio
} from '@/features/design/lib/layouts';
import { readImageDimensions } from '../lib/upload-image';
import { checkBalance } from '@/features/credits/api/service';
import { chargeOnGenerationResult } from '@/features/credits/lib/billing';
import { priceImage, priceVideo } from '@/features/credits/lib/pricing';
import { INSUFFICIENT_CREDITS_MESSAGE } from '@/features/credits/constants/credits';
import { getSignedUrl } from '@/lib/oss';
import type { AssetKind } from './types';

/** 单个资产的内容上限（字符数按 UTF-8 字节计算） */
export const MAX_ASSET_SIZE_BYTES = 200 * 1024;

const AGENT_INSTRUCTIONS = `你是「Agent 创作工作台」的编排 Agent，帮助用户产出高质量的内容作品。

工作方式：
1. 先用 1-3 句话说明你的创作计划，然后开始执行。
2. 当产出的内容构成完整作品（文案、文章、报告、网页等）时，必须调用 createAsset 工具把作品保存为资产：
   - Markdown 文章/文案 → kind 用 "markdown"
   - 完整 HTML 网页 → kind 用 "html"（必须是可直接打开运行的完整文档，样式与脚本内联，不依赖本地文件）
3. 当用户需要配图、封面、海报、插画等图片时，调用 createImageAsset 工具生成图片资产：
   - prompt 必须自包含：用中文详细描述主体、风格、构图、色调与氛围，不依赖对话上下文
   - 画面中需要出现文字时（如封面标题），在 prompt 中写明文字内容与位置
   - 需要竖版封面（小红书等）时用 aspect 指定 "3:4"；方形用 "1:1"、横版用 "16:9"；不确定时可不传
   - 图片生成通常需要 10-60 秒，等待期间不要重复调用；同时可继续撰写配套文案
4. 当用户要求修改、迭代已有图片（如"把刚才那张改成水墨风""背景换成夜晚"）时，调用 editImageAsset：
   - sourceAssetId 必须是真实存在的图片资产 id：来自上文 createImageAsset / editImageAsset 的返回值、findAssets 的检索结果，或用户消息中的 [引用资产] 块
   - instruction 描述修改要求；title 反映修改后的结果（如"杭州秋日漫步·水墨风"）
   - 一次编辑只基于一张源图；用户想改的图无法从上文确定时，先问清楚再调用
5. 复用用户已有作品（findAssets / readAsset）：
   - 用户消息中出现 [引用资产] 块时，直接使用块内给出的 id，不要再调 findAssets 检索
   - 用户用自然语言指向已有作品（"我之前那张秋天的图""基于这篇文案再写一版"）时，先用 findAssets 检索确认，绝不臆造 id 或内容
   - 命中多个候选时，列出候选请用户确认，或选最相关的一个并说明依据；findAssets 无命中时如实告知并请用户补充线索
   - 基于文本资产（markdown / html）改写或扩展 → 先 readAsset 取正文，再创作并用 createAsset 存为新资产（不要覆盖原资产）
   - 修改图片资产 → 用 editImageAsset（sourceAssetId 传该图 id），不要试图用 readAsset 的提示词去"重画"一张
6. 知识库（knowledgeSearch，按内容语义检索用户沉淀的资料）：
   - 用户说"我知识库里…""根据我的资料/笔记""基于我沉淀的文档写一版"，或问题必须引用用户自有资料才能作答时，先调 knowledgeSearch（可多次、用不同角度的 query）
   - 只依据返回的片段作答或创作，并说明引用了哪些文档（用 documentTitle 标注来源）
   - 无命中时如实告知"知识库中未找到相关资料"，绝不编造；可追问用户是否补充资料
   - 与 findAssets 的区别：findAssets 按标题关键词找「作品」（用于复用/改写）；knowledgeSearch 按语义找「资料」（用于问答/综述）
7. 一次回复可以产出多个资产（例如"三版文案"= 三个 markdown 资产；或先配图再写文案；或先 markdown 文案再配套 HTML 落地页）。
8. 保存完成后，用一两句话总结产出了什么，不要重复粘贴完整内容。
9. 默认使用中文；遵循用户指定的语气、风格与篇幅要求。
10. 不要编造需要实时数据支持的事实；不确定时明确说明。
11. 视频生成（createVideoAsset 文生视频 / createVideoFromImageAsset 图生视频）：
    - 何时用：用户需要动态画面（短视频、产品演示、动态封面、动画场景）时
    - 耗时提示：视频生成通常需要 1-5 分钟，调用前明确告知用户等待，不要重复调用
    - prompt 自包含：详细描述主体、动作、场景、氛围、镜头运动（如“镜头缓慢推进”）
    - 参数选择：默认 16:9 / 5s；竖版短视频用 9:16；用户显式指定时按用户要求
    - I2V：基于已有图片资产生成动态版本，用 createVideoFromImageAsset（sourceAssetId 传图片 id）
    - 成本约束：一次对话不要生成多个视频；用户要求“再来一版”时先确认是否真的需要
    - 失败处理：超时 / 内容审核 / 网络错误 → 如实告知用户，不要重试超过 1 次
12. 整版设计（composeDesign）：
    - 何时用：用户要“一张封面 / 海报 / 头图”，且需要把标题文字与图片排成完整版面时
    - 与 createImageAsset 的区别：只要一张图（文字画在图里或不需要文字）→ createImageAsset；
      要“图 + 可编辑标题文字”的整版 → composeDesign（文字以画布文字对象排布，用户可继续改）
    - imagePrompt 只描述画面，不要要求模型在图里写标题文字（标题由版式排上去，避免重字）
    - layout 选择：上图下文用 "top-image"（封面常用）；图为主视觉、标题压在底部用 "full-image-bar"；
      横版左图右文用 "left-image"（竖版会自动退化为上图下文）
    - 一次对话不要多次调用；内含一次文生图（约 20-70 秒），调用前告知用户等待
    - 产出无预览缩略图（用户打开画布保存后生成），告知用户点卡片去画布微调即可`;

const CREATE_ASSET_DESCRIPTION =
  '把一份完整作品保存为结构化资产。Markdown 文章/文案用 kind=markdown；完整 HTML 网页用 kind=html（必须是可以直接打开运行的完整文档，样式与脚本内联）。';

const createAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  kind: z.enum(['markdown', 'html']).describe('资产类型'),
  content: z.string().min(1).describe('资产完整内容')
});

const aspectFieldSchema = z
  .enum(ASPECT_KEYS)
  .optional()
  .describe(
    '可选：输出比例。竖版小红书封面用 "3:4"，方形 "1:1"，横版 "16:9" 等；不传由模型自动推荐分辨率'
  );

const CREATE_IMAGE_ASSET_DESCRIPTION =
  '用文生图模型生成一张图片并保存为图片资产。适合封面、海报、配图、插画等场景。prompt 必须完整自包含地描述画面（主体、风格、构图、色调、氛围），不依赖对话上下文；画面中需要出现文字（如标题）时，在 prompt 中写明文字内容与位置；需要竖版（如小红书封面）时用 aspect 指定 "3:4"。';

const createImageAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  prompt: z.string().min(1).max(2000).describe('文生图提示词：完整自包含的画面描述（中文优先）'),
  aspect: aspectFieldSchema
});

const EDIT_IMAGE_ASSET_DESCRIPTION =
  '在已有图片资产的基础上按用户要求进行图像编辑（图生图），产出新的图片资产。sourceAssetId 必须是真实存在的图片资产 id：来自上文 createImageAsset / editImageAsset 的返回值、findAssets 的检索结果，或用户消息中 [引用资产] 块给出的 id；instruction 描述修改要求（如"背景换成夜晚""改成水墨淡彩风格"）；title 反映修改后的结果。';

const editImageAssetInputSchema = z.object({
  sourceAssetId: z
    .string()
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

const COMPOSE_DESIGN_DESCRIPTION =
  '一句话产出「整版设计」（封面 / 海报 / 头图）：内部先文生图，再按版式模板把主图与标题 / 副标题排好版，产出可在设计画布继续编辑的 design 资产（文字为可编辑对象，非烧录到图里）。用户要「做一张…封面，标题是…」这类图文整版需求时用本工具；只要一张图时用 createImageAsset。imagePrompt 只描述画面（不要要求在图里写标题文字）；调用前先想好版式与文案；一次对话不要多次调用。';

const composeDesignInputSchema = z.object({
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

const videoAspectFieldSchema = z
  .enum(VIDEO_ASPECT_KEYS)
  .optional()
  .describe('可选：视频宽高比。横版用 "16:9"，竖版短视频用 "9:16"，方形 "1:1"；不传默认 "16:9"');

const videoDurationFieldSchema = z
  .number()
  .int()
  .min(2)
  .max(10)
  .optional()
  .describe('可选：视频时长（秒，2-10）；不传默认 5 秒');

const CREATE_VIDEO_ASSET_DESCRIPTION =
  '用文生视频模型生成一段短视频并保存为视频资产。适合产品演示、动态封面、短广告、动画场景。视频生成通常需要 1-5 分钟，耗时远高于图片，调用前先告知用户等待；prompt 必须自包含描述画面（主体、动作、场景、氛围、镜头运动）；一次对话不要生成多个视频（成本高）。';

const createVideoAssetInputSchema = z.object({
  title: z.string().min(1).max(100).describe('资产标题'),
  prompt: z
    .string()
    .min(1)
    .max(2000)
    .describe('文生视频提示词：完整自包含的画面与动作描述（中文优先，含镜头运动）'),
  aspect: videoAspectFieldSchema,
  duration: videoDurationFieldSchema
});

const CREATE_VIDEO_FROM_IMAGE_ASSET_DESCRIPTION =
  '在已有图片资产的基础上生成动态视频（图生视频），产出新的视频资产。sourceAssetId 必须是真实存在的图片资产 id（来自上文 createImageAsset / findAssets / [引用资产] 块）；prompt 描述希望的画面动作与镜头运动（如“镜头缓慢推进，花瓣随风飘落”）；title 反映结果。视频生成通常需要 1-5 分钟，调用前先告知用户等待。';

const createVideoFromImageAssetInputSchema = z.object({
  sourceAssetId: z
    .string()
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

const FIND_ASSETS_DESCRIPTION =
  '检索当前用户的资产库（「我的资产」），按标题关键词与类型查找可复用的已有作品，返回候选的元信息（assetId / title / kind / createdAt），不返回正文与图片。当用户提到"我之前那张""这篇文案""上次的封面"等指向已有作品时，先用它确认 assetId：文本资产接着用 readAsset 取正文，图片资产接着用 editImageAsset 修改。消息中已有 [引用资产] 块时不需要调用本工具。';

const findAssetsInputSchema = z.object({
  query: z
    .string()
    .max(100)
    .optional()
    .describe('标题关键词（模糊匹配），如"秋天""开学文案"；不确定时可省略以列出最近资产'),
  kind: z
    .enum(ASSET_KIND_VALUES)
    .optional()
    .describe('限定资产类型：markdown / html / image / design / video；不确定时可省略'),
  limit: z.number().int().min(1).max(20).optional().describe('返回条数上限，默认 8')
});

const READ_ASSET_DESCRIPTION =
  '读取指定资产的可用内容，用于"基于它再创作"（改写、扩展、总结、写配套文案等）。markdown / html 返回正文 content；image / video 返回其生成提示词 prompt（不返回图像/视频本身，要改图请用 editImageAsset）；design 为结构化数据，不支持读取正文。assetId 必须来自 findAssets 结果、上文工具返回值或消息中的 [引用资产] 块。';

const readAssetInputSchema = z.object({
  assetId: z.string().uuid().describe('要读取的资产 id（必须归属当前用户）')
});

const KNOWLEDGE_SEARCH_DESCRIPTION =
  '在用户的知识库（RAG）中按内容语义检索资料片段，返回 results: [{ documentId, documentTitle, chunkIndex, content, score }]（score 为相似度，越大越相关）。当用户说"我知识库里…""根据我的资料/笔记""基于我沉淀的文档写一版"，或问题需要引用用户自有资料才能作答时使用。只依据返回片段作答并用 documentTitle 标注来源；results 为空表示知识库中没有相关资料，应如实告知。与 findAssets 的区别：findAssets 按标题关键词找"作品"（用于复用/改写），knowledgeSearch 按语义找"资料"（用于问答/综述）。';

const knowledgeSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe('检索问句：用自然语言描述要找的内容（包含关键概念词效果更好）'),
  topK: z.number().int().min(1).max(8).optional().describe('返回片段数上限，默认 5')
});

/** 服务端校验历史消息使用（无需 execute，与 Agent 内工具共享同一 schema） */
export const agentValidationTools = {
  createAsset: tool({
    description: CREATE_ASSET_DESCRIPTION,
    inputSchema: createAssetInputSchema
  }),
  createImageAsset: tool({
    description: CREATE_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createImageAssetInputSchema
  }),
  editImageAsset: tool({
    description: EDIT_IMAGE_ASSET_DESCRIPTION,
    inputSchema: editImageAssetInputSchema
  }),
  createVideoAsset: tool({
    description: CREATE_VIDEO_ASSET_DESCRIPTION,
    inputSchema: createVideoAssetInputSchema
  }),
  createVideoFromImageAsset: tool({
    description: CREATE_VIDEO_FROM_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createVideoFromImageAssetInputSchema
  }),
  findAssets: tool({
    description: FIND_ASSETS_DESCRIPTION,
    inputSchema: findAssetsInputSchema
  }),
  readAsset: tool({
    description: READ_ASSET_DESCRIPTION,
    inputSchema: readAssetInputSchema
  }),
  knowledgeSearch: tool({
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    inputSchema: knowledgeSearchInputSchema
  }),
  composeDesign: tool({
    description: COMPOSE_DESIGN_DESCRIPTION,
    inputSchema: composeDesignInputSchema
  })
};

/** 与 agentValidationTools 对齐的 UI 消息类型（供 validateUIMessages 泛型推导 tools 校验类型） */
export type AgentValidationUIMessage = UIMessage<
  unknown,
  never,
  InferUITools<typeof agentValidationTools>
>;

function createAssetTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: CREATE_ASSET_DESCRIPTION,
    inputSchema: createAssetInputSchema,
    execute: async ({ title, kind, content }) => {
      const sizeBytes = Buffer.byteLength(content, 'utf8');
      if (sizeBytes > MAX_ASSET_SIZE_BYTES) {
        throw new Error(
          `资产内容超过上限（${Math.round(MAX_ASSET_SIZE_BYTES / 1024)}KB），请精简后重试。`
        );
      }
      const asset = await createAsset({
        userId: params.userId,
        conversationId: params.conversationId,
        title,
        kind: kind as AssetKind,
        content
      });
      return { assetId: asset.id, title, kind, sizeBytes: asset.sizeBytes };
    }
  });
}

function createImageAssetTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: CREATE_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createImageAssetInputSchema,
    execute: async ({ title, prompt, aspect }, { abortSignal }) => {
      // 计费入口拦截：余额 ≤0 直接拒绝（不发起上游调用），中文错误由工具输出展示
      if (!(await checkBalance(params.userId))) {
        throw new Error(INSUFFICIENT_CREDITS_MESSAGE);
      }
      // 「调用 → 拿临时 URL → 立即下载」在 generateImage 内完成（临时 URL 不外泄）；
      // abortSignal 透传：停止时同步取消进行中的请求与轮询（已创建的百炼任务会自然完成，无副作用）
      const size = aspect ? ASPECT_PRESETS[aspect] : undefined;
      // 发起后按结果扣：成功扣费；abort/超时/下载失败（billable）照扣；鉴权/参数/限流/审核拒绝不扣
      const asset = await chargeOnGenerationResult({
        userId: params.userId,
        kind: 'image',
        fallbackCharge: { cost: priceImage(false), meta: { edit: false } },
        run: async () => {
          const { imageBuffer, mime } = await generateImage({ prompt, size, signal: abortSignal });
          return createImageAsset({
            userId: params.userId,
            conversationId: params.conversationId,
            title,
            prompt,
            imageBuffer,
            mime
          });
        },
        buildCharge: (created) => ({
          cost: priceImage(false),
          meta: { assetId: created.id, edit: false }
        })
      });
      // 返回结构与 createAsset 对齐，复用对话内资产卡片渲染
      return { assetId: asset.id, title, kind: 'image' as const, sizeBytes: asset.sizeBytes };
    }
  });
}

export function editImageAssetTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: EDIT_IMAGE_ASSET_DESCRIPTION,
    inputSchema: editImageAssetInputSchema,
    execute: async ({ sourceAssetId, title, instruction, aspect }, { abortSignal }) => {
      // 计费入口拦截：余额 ≤0 直接拒绝（不发起上游调用）
      if (!(await checkBalance(params.userId))) {
        throw new Error(INSUFFICIENT_CREDITS_MESSAGE);
      }
      // 核心流程（预检 → 签名 URL → I2I → 落库血缘）抽至 image-edit.ts，与直连端点复用；
      // abortSignal 透传：停止时同步取消进行中的请求（已创建的百炼任务会自然完成，无副作用）
      // 发起后按结果扣（I2I 与 T2I 同价）：源图预检失败（ImageEditError，未发起上游）不扣
      const asset = await chargeOnGenerationResult({
        userId: params.userId,
        kind: 'image',
        fallbackCharge: { cost: priceImage(true), meta: { edit: true, sourceAssetId } },
        run: () =>
          editImageAssetCore({
            userId: params.userId,
            sourceAssetId,
            instruction,
            aspect,
            title,
            conversationId: params.conversationId,
            signal: abortSignal
          }),
        buildCharge: (created) => ({
          cost: priceImage(true),
          meta: { assetId: created.id, edit: true, sourceAssetId }
        })
      });
      // 返回结构与 createImageAsset 对齐，复用对话内资产卡片渲染；sourceAssetId 供后续继续迭代追溯
      return {
        assetId: asset.id,
        title: asset.title,
        kind: 'image' as const,
        sizeBytes: asset.sizeBytes,
        sourceAssetId
      };
    }
  });
}

/**
 * 文生视频工具（T2V）。
 * 视频成本高，先在 execute 入口做限流（video scope，5 次/分/用户），命中直接拒绝，
 * 不进入昂贵的生成；限流失败以中文错误抛出，由对话内 tool-video-part 展示。
 * 「提交任务 → 轮询 → 下载」在 generateVideoAsset 内完成（临时 URL 不外泄）；
 * abortSignal 透传：停止时同步取消轮询与下载（已提交的百炼任务自然完成，无副作用）。
 */
function createVideoAssetTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: CREATE_VIDEO_ASSET_DESCRIPTION,
    inputSchema: createVideoAssetInputSchema,
    execute: async ({ title, prompt, aspect, duration }, { abortSignal }) => {
      const allowed = await checkRateLimit(
        'video',
        params.userId,
        VIDEO_RATE_LIMIT,
        VIDEO_RATE_WINDOW_SECONDS
      );
      if (!allowed) {
        throw new Error(
          `视频生成过于频繁（每 ${VIDEO_RATE_WINDOW_SECONDS} 秒最多 ${VIDEO_RATE_LIMIT} 次），请稍后再试。`
        );
      }
      // 计费入口拦截：与限流并列，余额 ≤0 直接拒绝（不发起上游调用）
      if (!(await checkBalance(params.userId))) {
        throw new Error(INSUFFICIENT_CREDITS_MESSAGE);
      }
      // 工具默认 720P（generateVideoAsset 缺省档）；错误兜底按入参时长估算
      const fallbackDuration = duration ?? 5;
      // 发起后按结果扣：成功按实际分辨率×秒扣；abort/超时/下载失败（billable）按兜底照扣；审核/鉴权/参数/限流不扣
      const result = await chargeOnGenerationResult({
        userId: params.userId,
        kind: 'video',
        fallbackCharge: {
          cost: priceVideo('720P', fallbackDuration),
          meta: { resolution: '720P', duration: fallbackDuration }
        },
        run: async () => {
          const generated = await generateVideoAsset({
            prompt,
            aspect,
            duration,
            signal: abortSignal
          });
          const asset = await createVideoAsset({
            userId: params.userId,
            conversationId: params.conversationId,
            title,
            prompt,
            videoBuffer: generated.videoBuffer,
            mime: generated.mime
          });
          return { asset, resolution: generated.resolution, duration: generated.duration };
        },
        buildCharge: (r) => ({
          cost: priceVideo(r.resolution, r.duration),
          meta: { assetId: r.asset.id, resolution: r.resolution, duration: r.duration }
        })
      });
      // 返回结构与 createImageAsset 对齐，复用对话内视频卡片渲染
      return {
        assetId: result.asset.id,
        title,
        kind: 'video' as const,
        sizeBytes: result.asset.sizeBytes
      };
    }
  });
}

/**
 * 图生视频工具（I2V）：以已有图片资产作首帧。
 * 源图校验复用图片编辑（editImageAssetCore）的预检逻辑：归属 / kind='image' / storageKey 非空 / ≤10MB；
 * 源图经短期签名 URL（TTL 900s，覆盖生成全程）作首帧；产出派生视频资产（sourceAssetId 记录血缘）。
 */
function createVideoFromImageAssetTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: CREATE_VIDEO_FROM_IMAGE_ASSET_DESCRIPTION,
    inputSchema: createVideoFromImageAssetInputSchema,
    execute: async ({ sourceAssetId, title, prompt, aspect, duration }, { abortSignal }) => {
      const allowed = await checkRateLimit(
        'video',
        params.userId,
        VIDEO_RATE_LIMIT,
        VIDEO_RATE_WINDOW_SECONDS
      );
      if (!allowed) {
        throw new Error(
          `视频生成过于频繁（每 ${VIDEO_RATE_WINDOW_SECONDS} 秒最多 ${VIDEO_RATE_LIMIT} 次），请稍后再试。`
        );
      }
      // 计费入口拦截：与限流并列，余额 ≤0 直接拒绝（不发起上游调用）
      if (!(await checkBalance(params.userId))) {
        throw new Error(INSUFFICIENT_CREDITS_MESSAGE);
      }
      // 归属校验：源资产必须属于当前用户、为图片且已转入 OSS（越权与不存在同样返回 undefined）
      // 预检失败（未发起上游）→ 不扣
      const source = await getAsset(params.userId, sourceAssetId);
      if (!source || source.kind !== 'image' || !source.storageKey) {
        throw new Error(
          '找不到可用作首帧的源图片资产（可能已删除或不是图片），请用 findAssets 重新确认。'
        );
      }
      if (source.sizeBytes && source.sizeBytes > MAX_EDIT_SOURCE_BYTES) {
        throw new Error('源图片体积超过输入上限（10MB），无法生成视频。');
      }
      // 源图经短期签名 URL 直传百炼作首帧（公网可达；TTL 900s 与图片编辑一致）
      const firstFrameUrl = await getSignedUrl(source.storageKey, 900);
      // 工具默认 720P；错误兜底按入参时长估算
      const fallbackDuration = duration ?? 5;
      // 发起后按结果扣：成功按实际分辨率×秒扣；abort/超时/下载失败（billable）按兜底照扣；审核/鉴权/参数/限流不扣
      const result = await chargeOnGenerationResult({
        userId: params.userId,
        kind: 'video',
        fallbackCharge: {
          cost: priceVideo('720P', fallbackDuration),
          meta: { resolution: '720P', duration: fallbackDuration, sourceAssetId }
        },
        run: async () => {
          const generated = await generateVideoAsset({
            prompt,
            modelKey: DEFAULT_I2V_MODEL,
            aspect,
            duration,
            firstFrameUrl,
            signal: abortSignal
          });
          const asset = await createVideoAsset({
            userId: params.userId,
            conversationId: params.conversationId,
            title,
            prompt,
            videoBuffer: generated.videoBuffer,
            mime: generated.mime,
            sourceAssetId
          });
          return { asset, resolution: generated.resolution, duration: generated.duration };
        },
        buildCharge: (r) => ({
          cost: priceVideo(r.resolution, r.duration),
          meta: {
            assetId: r.asset.id,
            resolution: r.resolution,
            duration: r.duration,
            sourceAssetId
          }
        })
      });
      // 返回结构与 editImageAsset 对齐；sourceAssetId 供后续追溯血缘
      return {
        assetId: result.asset.id,
        title,
        kind: 'video' as const,
        sizeBytes: result.asset.sizeBytes,
        sourceAssetId
      };
    }
  });
}

/**
 * 资产库检索工具：只读元信息，按 userId 过滤（归属校验在 searchAssets 内完成）。
 * 不回传 content / storageKey / 签名 URL：避免工具输出膨胀，也避免图片地址流入模型上下文。
 */
function findAssetsTool(params: { userId: string }) {
  return tool({
    description: FIND_ASSETS_DESCRIPTION,
    inputSchema: findAssetsInputSchema,
    execute: async ({ query, kind, limit }) => {
      const hits = await searchAssets(params.userId, { query, kind, limit });
      return { assets: hits };
    }
  });
}

/**
 * 资产正文读取工具：按 kind 分支返回可用内容。
 * 图片只回传生成提示词（像素不进上下文，改图走 editImageAsset 服务端传参）；
 * 归属校验复用 getAsset（越权与不存在同样返回 undefined，不泄漏存在性）。
 */
function readAssetTool(params: { userId: string }) {
  return tool({
    description: READ_ASSET_DESCRIPTION,
    inputSchema: readAssetInputSchema,
    execute: async ({ assetId }) => {
      const asset = await getAsset(params.userId, assetId);
      if (!asset) {
        throw new Error('找不到该资产（可能已删除或不属于当前用户），请用 findAssets 重新检索。');
      }
      if (asset.kind === 'markdown' || asset.kind === 'html') {
        return {
          kind: asset.kind,
          title: asset.title,
          content: asset.content ?? '',
          hint: '这是文本资产正文；请基于它按用户要求改写/扩展，并用 createAsset 保存为新资产。'
        };
      }
      if (asset.kind === 'image') {
        return {
          kind: asset.kind,
          title: asset.title,
          prompt: asset.content ?? '',
          hint: `这是图片资产（prompt 为其生成提示词）；若要在其基础上修改，请调用 editImageAsset 并把 ${assetId} 作为 sourceAssetId。`
        };
      }
      if (asset.kind === 'video') {
        return {
          kind: asset.kind,
          title: asset.title,
          prompt: asset.content ?? '',
          hint: '这是视频资产（prompt 为其生成提示词）；视频暂不支持在其基础上直接编辑。'
        };
      }
      return {
        kind: asset.kind,
        title: asset.title,
        hint: '设计文档为结构化数据，暂不支持读取正文。'
      };
    }
  });
}

/**
 * 知识库语义检索工具：embed(query) → pgvector cosine topK（均在 knowledge 服务层完成）。
 * 只回传命中片段与来源标题（不回传向量）；低相关片段已按阈值过滤，
 * 空结果时额外给出"如实告知"提示，降低模型臆造概率。
 */
function knowledgeSearchTool(params: { userId: string }) {
  return tool({
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    inputSchema: knowledgeSearchInputSchema,
    execute: async ({ query, topK }) => {
      const results = await searchKnowledgeByText(params.userId, query, topK);
      return {
        results,
        hint:
          results.length === 0
            ? '知识库中未找到相关资料：请如实告知用户，不要编造内容。'
            : '请只依据以上片段作答或创作，并用 documentTitle 说明引用了哪些文档。'
      };
    }
  });
}

/** "宽*高" 尺寸档 → 像素尺寸（sharp 读不到主图自然尺寸时的回退，供版式 contain 适配） */
function parsePixelSize(size: string): { width: number; height: number } | null {
  const [width, height] = size.split('*').map(Number);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * 从文生图比例档中挑与目标宽高比最接近的一档。
 * 整版设计的主图比例按**版式的主图区域**选（而非画布比例），
 * 这样 contain 适配后几乎不留白（画布比例仍由 aspect 决定，两者可不同）。
 */
function nearestAspect(targetRatio: number): AspectKey {
  let best: AspectKey = '1:1';
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const key of ASPECT_KEYS) {
    const size = parsePixelSize(ASPECT_PRESETS[key]);
    if (!size) continue;
    const diff = Math.abs(size.width / size.height - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = key;
    }
  }
  return best;
}

/**
 * 整版设计工具：文生图（计费 image 档）→ 版式组装（服务端纯函数，布局质量不交给模型）
 * → design 资产落库（previewPng=null：服务端渲染中文字体不可靠，预览由画布保存时客户端导出补上）。
 * 主图仍沉淀为独立 image 资产（可在「我的资产」复用）；design 落库为纯 JSON 组装、不调付费 API → 不额外计费。
 */
function composeDesignTool(params: { userId: string; conversationId: string }) {
  return tool({
    description: COMPOSE_DESIGN_DESCRIPTION,
    inputSchema: composeDesignInputSchema,
    execute: async (
      { title, imagePrompt, heading, subheading, layout, aspect },
      { abortSignal }
    ) => {
      // 计费入口拦截：余额 ≤0 直接拒绝（不发起上游调用）
      if (!(await checkBalance(params.userId))) {
        throw new Error(INSUFFICIENT_CREDITS_MESSAGE);
      }
      const resolvedAspect = aspect ?? DEFAULT_LAYOUT_ASPECT;
      // 主图按版式区域比例生成（贴合区域 → contain 后几乎无留白），画布仍用 aspect
      const size = ASPECT_PRESETS[nearestAspect(imageRegionRatio(layout, resolvedAspect))];
      // 主图生成与 createImageAsset 工具同源（同一计费包裹、billable 分类、abort 透传）
      const generated = await chargeOnGenerationResult({
        userId: params.userId,
        kind: 'image',
        fallbackCharge: { cost: priceImage(false), meta: { edit: false, compose: true } },
        run: async () => {
          const { imageBuffer, mime } = await generateImage({
            prompt: imagePrompt,
            size,
            signal: abortSignal
          });
          // 版式需要主图真实比例做 contain 适配；sharp 读失败时回退请求的尺寸档
          const natural = (await readImageDimensions(imageBuffer)) ?? parsePixelSize(size);
          const asset = await createImageAsset({
            userId: params.userId,
            conversationId: params.conversationId,
            title: `${title}·主图`,
            prompt: imagePrompt,
            imageBuffer,
            mime
          });
          return { asset, natural };
        },
        buildCharge: (created) => ({
          cost: priceImage(false),
          meta: { assetId: created.asset.id, edit: false, compose: true }
        })
      });

      // 组装与 sanitize 均为纯函数（内部已兜底回落），不因排版问题浪费已生成并扣费的主图
      const composed = composeDesignDocument({
        layout,
        aspect: resolvedAspect,
        image: { assetId: generated.asset.id, natural: generated.natural },
        text: { heading: heading?.trim() || title, subheading }
      });
      const design = await createDesignAsset({
        userId: params.userId,
        title,
        document: JSON.stringify(composed),
        previewPng: null
      });
      // 返回结构与其他资产工具对齐；kind='design' 由对话内 design 卡片渲染为「打开编辑」
      return {
        assetId: design.id,
        title,
        kind: 'design' as const,
        sizeBytes: design.sizeBytes,
        imageAssetId: generated.asset.id
      };
    }
  });
}

/**
 * 对话 usage 累加器（route 创建并传入 buildAgent）。
 * onStepEnd 把每步 usage 累加进去（对已完成的步触发，含 abort 前的步），
 * route 的 toUIMessageStream onEnd 读累加器 + isAborted 统一结算扣费。
 * （toUIMessageStream 的 onEnd 不暴露 usage，故须经 onStepEnd 桥接，见 docs/credits.md §6.1）
 */
export interface UsageSink {
  inputTokens: number;
  outputTokens: number;
}

/**
 * 把技能示例渲染为 system 内的「示范」段落（few-shot，空则返回 ''）。
 * 示例随 system 每次请求发送，总长控制见 skills.ts 约定（每技能 ≤2 条、单条精简）。
 */
function renderExamples(examples?: readonly SkillExample[]): string {
  if (!examples?.length) return '';
  const rendered = examples
    .map((example) => `用户：${example.input}\n你：${example.output}`)
    .join('\n\n');
  return `\n\n## 示范（模仿以下输出结构与风格，不要照搬内容）\n\n${rendered}`;
}

/**
 * 每请求构建一个 Agent（serverless 无状态，上下文经闭包注入工具）。
 * skillId：会话级技能（专家模式）；命中注册表时把技能指令 + 示例追加到基础指令后，
 * 并按 skill.tools 白名单过滤注册给模型的工具（未声明技能或技能未声明 tools = 全量）。
 * 注意：agentValidationTools 恒为全量不随技能过滤 —— 会话中途切技能后，
 * 旧消息可能含已被当前技能禁用的工具调用，若校验工具也过滤会导致历史校验 400。
 * 防御：未知/已下架 id（getSkill → undefined）回退基础指令 + 全量工具，不报错。
 */
export function buildAgent(params: {
  userId: string;
  conversationId: string;
  modelKey: string;
  skillId?: string | null;
  /** 可变 usage 累加器：onStepEnd 累加每步 usage，供 route 的 onEnd 结算扣费（每请求新建，无跨请求污染） */
  usageSink?: UsageSink;
}) {
  const modelKey = isModelKey(params.modelKey) ? params.modelKey : DEFAULT_MODEL;
  const skill = getSkill(params.skillId);
  const skillBlock = skill
    ? `\n\n# 当前技能：${skill.name}\n${skill.instructions}${renderExamples(skill.examples)}`
    : '';
  const instructions = `${AGENT_INSTRUCTIONS}${skillBlock}`;
  // 工具名 → 工厂（与 agentValidationTools 的 9 工具一一对应）；按技能白名单懒构建，
  // 未声明技能或技能未声明 tools 时回退全量（向后兼容，无技能 = 通用兜底）
  const toolFactories: Record<AgentToolName, () => Tool> = {
    createAsset: () => createAssetTool(params),
    createImageAsset: () => createImageAssetTool(params),
    editImageAsset: () => editImageAssetTool(params),
    createVideoAsset: () => createVideoAssetTool(params),
    createVideoFromImageAsset: () => createVideoFromImageAssetTool(params),
    findAssets: () => findAssetsTool(params),
    readAsset: () => readAssetTool(params),
    knowledgeSearch: () => knowledgeSearchTool(params),
    composeDesign: () => composeDesignTool(params)
  };
  const allowedTools = skill?.tools ?? AGENT_TOOL_NAMES;
  const tools = Object.fromEntries(
    allowedTools.map((name) => [name, toolFactories[name]()])
  ) as Record<string, Tool>;
  return new ToolLoopAgent({
    model: resolveModel(modelKey),
    instructions,
    tools,
    stopWhen: isStepCount(6),
    // totalMs 必须 ≥ 视频轮询上限（VIDEO_POLL_TIMEOUT_MS=280s）+ 转存/落库开销，
    // 否则长视频会被 Agent 总超时提前中止；上限仍 < Route Handler maxDuration=300（平台硬杀）。
    timeout: { totalMs: 295_000 },
    // 生命周期回调（官方推荐 onStepEnd/onEnd）：记录 step/usage/工具调用，为限额、计费与排障提供数据
    onStepEnd: ({ stepNumber, finishReason, toolCalls, usage }) => {
      // 累加每步 usage 到 route 传入的累加器（对已完成的步触发，含 abort 前的步）；
      // token 可能 undefined（provider 未回），防御为 0，结算侧 priceChat 再兑底至少 1 credit
      if (params.usageSink) {
        params.usageSink.inputTokens += usage.inputTokens ?? 0;
        params.usageSink.outputTokens += usage.outputTokens ?? 0;
      }
      console.warn('[agent] step finished', {
        stepNumber,
        finishReason,
        toolCalls: toolCalls?.map((toolCall) => toolCall.toolName) ?? [],
        totalTokens: usage.totalTokens
      });
    },
    onEnd: ({ usage, steps }) => {
      console.warn('[agent] run finished', {
        totalSteps: steps.length,
        totalTokens: usage.totalTokens
      });
    }
  });
}
