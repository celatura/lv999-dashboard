/**
 * 技能注册表 —— 按需加载的「专家工作流包」：
 * system 里只常驻轻量目录（名称 + 何时用），模型判断任务匹配后调用 loadSkill
 * 读取完整正文（instructions + 示例），正文作为 tool result 进入消息历史；
 * 用户也可以对「某一条消息」显式指定技能（消息 metadata.skillId），服务端直接注入并限制工具边界。
 *
 * 本文件只定义「预置技能」（全局只读、随代码发布）；用户自建技能在 skills 表，
 * 二者映射为同一 SkillRegistryEntry，复用目录 / 加载 / 工具边界逻辑。
 * id 是稳定 key（预置为 slug，自定义为 uuid），也是历史消息 / 续答回灌的解析依据；
 * 改名不影响已持久化的引用，但 id 一旦发布不可更改（见 docs/agent.md §5.1）。
 *
 * 依赖方向：agent.ts → 本文件（单向）。工具名联合类型定义在此，避免反向 import 循环；
 * 历史消息校验用的 agentValidationTools 恒为全量（不随技能过滤），只有 buildAgent 的 tools 受限。
 */

/** Agent 业务工具名（技能工具边界可配置；loadSkill / askUser 为系统工具，不在此列） */
export const AGENT_TOOL_NAMES = [
  'createAsset',
  'editAsset',
  'createImageAsset',
  'editImageAsset',
  'createVideoAsset',
  'createVideoFromImageAsset',
  'findAssets',
  'readAsset',
  'knowledgeSearch',
  'composeDesign'
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/**
 * 工具中文名（自定义技能表单的工具边界勾选用；与 AGENT_TOOL_NAMES 一一对应）。
 * 新增工具时需同步补充本表，否则表单勾选框缺标签。
 */
export const AGENT_TOOL_LABELS: Record<AgentToolName, string> = {
  createAsset: '保存作品（Markdown / HTML）',
  editAsset: '精确编辑文本资产',
  createImageAsset: '文生图',
  editImageAsset: '图片编辑（改图）',
  createVideoAsset: '文生视频',
  createVideoFromImageAsset: '图生视频',
  findAssets: '检索我的资产',
  readAsset: '读取资产正文',
  knowledgeSearch: '知识库检索',
  composeDesign: '整版设计（封面 / 海报）'
};

export interface SkillExample {
  /** 用户输入（示范场景） */
  input: string;
  /** 期望输出（风格/结构示范，宜精简，建议 ≤300 字） */
  output: string;
}

export interface SkillRegistryEntry {
  /** 稳定 key，存库用 */
  id: string;
  /** 展示名（如「电商套图设计专家」）；同一用户内唯一（loadSkill 先按 id、再按名称解析） */
  name: string;
  /** 「何时用」一句话，供目录展示、模型路由与搜索 */
  description: string;
  /** 技能完整正文（专家人设 + 工作流），按需加载 */
  instructions: string;
  /** 选中后输入框引导语 */
  placeholder?: string;
  /** 工具边界；未声明 = 全量（加载后本次回复内生效） */
  tools?: readonly AgentToolName[];
  /** few-shot 示范（每技能 ≤2 条），随正文按需返回，不常驻 system */
  examples?: readonly SkillExample[];
}

export const SKILL_REGISTRY: Record<string, SkillRegistryEntry> = {
  'ecommerce-imagery': {
    id: 'ecommerce-imagery',
    name: '电商套图设计专家',
    description:
      '当用户要做商品主图、卖点图、详情页头图或整套电商视觉时使用；不用于纯文字写作、视频生成。',
    instructions: `你现在戴上「电商套图设计专家」的帽子，以资深电商视觉策划的身份与用户持续协作。

专业要求：
- 产出围绕转化：主图突出商品与核心卖点，卖点图一图讲一个点，文案短促有行动号召力。
- 图片规划遵循平台惯例：主图 1:1，详情页配图可横版 16:9；画面干净、主体居中、留白充足。
- 文案遵循广告法底线：不用「最」「第一」「国家级」等绝对化用语，不编造功效与数据。

工作流：
1. 开工前先确认四要素：商品是什么、目标人群、核心卖点（1-3 个）、投放平台/尺寸要求；用户消息里有 [引用资产] 的产品图时，直接以它为素材基准（改图用 editImageAsset，不要凭空重画产品）。
2. 缺关键信息时一次性追问，不要挤牙膏式提问；引用产品图不会让你看到图像内容，用户只给产品图时，请用户描述商品信息，不要推测。
3. 给出整套方案（主图 / 卖点图 / 详情页文案的清单与思路）并说明设计理由，得到认可或用户无异议后逐项执行。
4. 每张图用 createImageAsset 生成（prompt 自包含：商品主体、场景、构图、色调、文字内容与位置）；需要「图 + 可编辑标题文字」的活动海报 / 详情页头图时用 composeDesign（横版头图选 layout "left-image" 或 "full-image-bar"、aspect "16:9"）；详情页文案用 createAsset 存为 markdown，后续局部改文案用 editAsset 精确替换。
5. 交付时总结整套资产清单与使用建议，并主动提出可迭代方向（换背景、改文案、加节令氛围等）。`,
    // 图文场景：禁用昂贵视频工具（createVideoAsset / createVideoFromImageAsset），防误调烧成本
    tools: [
      'createAsset',
      'editAsset',
      'createImageAsset',
      'editImageAsset',
      'composeDesign',
      'findAssets',
      'readAsset',
      'knowledgeSearch'
    ],
    examples: [
      {
        input: '这款保温杯主打 12 小时保温，帮我做一套电商图',
        output:
          '收到。开工前确认四要素：目标人群（通勤族/户外？）、除「12 小时保温」外还有无次级卖点（容量/材质/颜色）、投放平台与尺寸要求（天猫主图 1:1？）、有无现成产品图。\n\n若信息齐全，我的整套方案是：\n1. 主图（1:1）：createImageAsset，纯色浅背景、杯体居中、顶部小字「12 小时长效保温」，突出商品本身；\n2. 卖点图 ×2（1:1）：一图讲一个点——保温实测场景（户外雪地手持）、材质剖面特写；\n3. 详情页头图（16:9）：composeDesign（layout "full-image-bar"），主视觉 + 可编辑标题「12 小时，随时一口热的」；\n4. 详情页文案：createAsset 存 markdown（钩子开头 → 卖点分段 → 参数表 → 行动号召）。\n\n确认后我逐项执行，每张图的 prompt 都会自包含商品主体、场景、构图与文字位置。'
      }
    ],
    placeholder: '把产品图引用进来，或直接描述你的商品与卖点…'
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    name: '小红书图文专家',
    description:
      '当用户要写小红书笔记、标题/话题标签或竖版封面时使用；不用于电商详情页、长文报告。',
    instructions: `你现在戴上「小红书图文专家」的帽子，以资深小红书内容操盘手的身份与用户持续协作。

专业要求：
- 标题：20 字以内，善用数字、悬念、对比与情绪钩子，一次给 3-5 个候选。
- 正文：口语化短句分段，适度使用 emoji，结构为「钩子开头 → 干货/体验主体 → 互动引导结尾」，300-800 字。
- 话题标签：结尾附 5-8 个与内容强相关的 #话题，兼顾大流量词与精准长尾词。
- 封面：竖版 3:4，画面主体突出；标题文字优先用整版设计排上去（可编辑、字体稳定），只有用户明确要求“文字画在图里”时才写进 prompt。
- 真实性底线：不编造个人体验数据与效果承诺；商业推广内容提醒用户按平台规则标注。

工作流：
1. 先确认选题方向、目标人群与账号调性；用户给了素材（引用资产/知识库资料）时先消化再动笔。
2. 一次交付完整笔记包：标题候选 + 正文 + 话题标签，用 createAsset 存为 markdown（一篇笔记一个资产）；用户要求局部调整（换标题、改措辞）时用 editAsset 精确替换，不要整篇重存。
3. 封面优先用 composeDesign 生成**整版设计**（aspect 传 "3:4"、layout 选 "top-image"，heading 传标题、subheading 传一句话钩子，imagePrompt 只描述画面）——产出可在设计画布继续改字色/换图；只要一张图（标题烧录在画面里）时用 createImageAsset（aspect "3:4"）；用户已有满意的图想改封时用 editImageAsset。
4. 交付后主动给出发布建议（发布时间、首评引导）与可迭代方向（换标题风格、调整人设语气、做系列选题）。`,
    // 图文场景：同电商技能，禁用视频工具
    tools: [
      'createAsset',
      'editAsset',
      'createImageAsset',
      'editImageAsset',
      'composeDesign',
      'findAssets',
      'readAsset',
      'knowledgeSearch'
    ],
    examples: [
      {
        input: '分享我的露营装备，帮我出一篇笔记',
        output:
          '标题候选（20 字内）：\n1. 新手露营别乱买！这 5 件就够了\n2. 花 3000 块总结的露营装备清单⛺\n3. 第一次露营就出片，全靠这些装备\n\n正文（口语化短句，钩子→干货→互动）：\n去年第一次露营，我拖了三个大箱子，回来发现一半没用上😂 今天把真正高频的 5 件整理给你们——\n🏕️ 帐篷：3-4 人双层防雨款，搭建 10 分钟内……\n（中略）\n你们露营必带的一件是什么？评论区抄作业👇\n\n#露营装备 #新手露营 #露营清单 #户外生活 #周末去哪儿 #装备党\n\n笔记包我会用 createAsset 存为 markdown；封面接着用 composeDesign 出 3:4 整版（layout "top-image"，heading 传选定的标题，imagePrompt 只描述清晨营地画面），产出可在画布继续改字色。'
      }
    ],
    placeholder: '想发什么主题的笔记？给我选题、素材或目标人群…'
  },
  'general-creation': {
    id: 'general-creation',
    name: '通用创作专家',
    description:
      '当用户要写长文、报告、方案、白皮书或完整网页时使用；普通问答、短文案、闲聊不要加载。',
    instructions: `你现在戴上「通用创作专家」的帽子，以资深内容主创的身份与用户持续协作。

专业要求：
- 先谋后写：动笔前给出结构大纲（章节/要点/篇幅预估），与用户对齐后再展开。
- 观点明确、论据具体：不堆砌空话套话；需要事实支撑时优先查用户知识库（knowledgeSearch）或已有作品（findAssets / readAsset）。
- 风格适配：跟随用户指定的语气、受众与篇幅；未指定时按内容类型选择行业通行风格。

工作流：
1. 需求模糊时先澄清三件事：写给谁看、要达成什么目的、期望的形态与篇幅。
2. 大纲确认后逐节成稿；长文档一次成稿后用 createAsset 存为 markdown，网页类交付存为 html。
3. 交付后总结要点，并主动提出修改方向（精简、扩写、换风格、补配图）。`,
    // 不声明 tools = 全量工具（通用兜底：指令含“补配图”等，需要生图/视频等全部能力）
    examples: [
      {
        input: '帮我写一份季度工作总结',
        output:
          '动笔前先对齐结构。我建议的大纲：\n1. 季度概览（3 句话：目标、达成、最大亮点）\n2. 重点工作复盘（3-4 项，每项按「目标 → 动作 → 结果数据」展开）\n3. 问题与改进（1-2 条，带下一步动作）\n4. 下季度计划（3 条，可衡量）\n预计全文 1200 字左右。\n\n请补充：写给谁看（直属领导/全员）、本季度 2-3 个关键成果数据。确认后我逐节成稿，完成用 createAsset 存为 markdown，再给你精简版/扩写版等修改方向。'
      }
    ],
    placeholder: '描述你想创作的内容：主题、受众与期望形态…'
  }
};

export const SKILL_IDS = Object.keys(SKILL_REGISTRY);

/** 预置技能按注册顺序展开（路由目录的实际顺序由 skill-service 决定：自定义优先） */
export const PRESET_SKILLS: readonly SkillRegistryEntry[] = SKILL_IDS.map(
  (id) => SKILL_REGISTRY[id]
);

/** 是否为代码内预置技能 id（预置只读 / 兼容性校验用） */
export function isPresetSkillId(id: string): boolean {
  return Object.hasOwn(SKILL_REGISTRY, id);
}

/**
 * 名称是否被预置占用：预置名称或预置 id 都不可作为自定义技能名。
 * loadSkill 先按 id、再按 name 解析；若允许自定义技能叫 'xiaohongshu'，
 * 模型按目录名称加载时会静默命中预置 id，因此写入时必须拦截。
 */
export function isReservedSkillName(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return (
    PRESET_SKILLS.some((entry) => entry.name.trim().toLocaleLowerCase() === normalized) ||
    isPresetSkillId(normalized)
  );
}

/**
 * 按引用解析技能：先精确匹配 id（稳定 key），再按展示名（trim + 大小写不敏感）。
 * 调用方传入的数组顺序决定同名时的优先级（路由场景由 skill-service 保证自定义在前）。
 */
export function findSkillByRef(
  skills: readonly SkillRegistryEntry[],
  ref: string
): SkillRegistryEntry | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const byId = skills.find((entry) => entry.id === trimmed);
  if (byId) return byId;
  const normalized = trimmed.toLocaleLowerCase();
  return skills.find((entry) => entry.name.trim().toLocaleLowerCase() === normalized);
}

/** 常驻 system 的技能目录上限：控制每请求 token；超出部分不在目录中，模型无法自动选择 */
export const MAX_CATALOG_SKILLS = 16;

/**
 * 计算加载技能后的有效业务工具集：声明了 tools 的技能取交集，未声明 = 全量、不额外放宽。
 * 返回 null 表示不限制（没有任何已加载技能声明 tools）；空数组表示只剩系统工具可用。
 * 空 tools 数组（旧数据）按“无业务工具”处理，不视为全量；schema 已拒绝新写入空数组。
 * 注意：这是成本/能力提示，不是安全边界；真正的兜底是 Credits 与工具级限流。
 */
export function computeActiveTools(
  loadedSkills: readonly SkillRegistryEntry[]
): readonly AgentToolName[] | null {
  // undefined = 未声明（全量）；[] = 显式声明但为空（旧数据 -> 无业务工具）
  const restricted = loadedSkills.filter((skill) => skill.tools !== undefined);
  if (restricted.length === 0) return null;
  let active = new Set<string>(AGENT_TOOL_NAMES);
  for (const skill of restricted) {
    const allowed = new Set<string>(skill.tools ?? []);
    active = new Set([...active].filter((name) => allowed.has(name)));
  }
  return AGENT_TOOL_NAMES.filter((name) => active.has(name));
}

/**
 * system 内的常驻技能目录：只有名称 + 何时用（轻量），完整正文由 loadSkill 按需拉取。
 * 目录是稳定前缀，利于 provider 侧上下文缓存；超出上限的技能不在目录中（无法自动选择）。
 */
export function renderSkillCatalog(skills: readonly SkillRegistryEntry[]): string {
  if (skills.length === 0) return '';
  const catalog = skills
    .slice(0, MAX_CATALOG_SKILLS)
    .map((skill) => `- ${skill.name}：${skill.description}`)
    .join('\n');
  const overflow =
    skills.length > MAX_CATALOG_SKILLS
      ? `\n（另有 ${skills.length - MAX_CATALOG_SKILLS} 个技能未在目录中；目录最多 ${MAX_CATALOG_SKILLS} 个，优先展示你的自定义技能，可在技能管理页查看。）`
      : '';
  return `\n\n# 可用技能（按需加载）\n当用户任务明显匹配下面的某个技能时，先调用 loadSkill 加载它的完整工作流，再按该工作流执行；不要凭空假设技能内容。若历史中已加载过同一技能，可直接沿用。\n${catalog}${overflow}\n技能加载后，在本次回复内按该技能的指令与工具边界工作；一次回复尽量只加载一个技能（多个技能的工具边界取交集，可能裁掉必需工具）。`;
}

/**
 * 技能正文渲染：instructions + few-shot 示范段落（空则仅 instructions）。
 * 由 loadSkill 工具结果与「本条消息指定技能」的 system 注入共用，保证两种入口内容一致。
 */
export function renderSkillBody(skill: SkillRegistryEntry): string {
  const examples = skill.examples?.length
    ? `\n\n## 示范（模仿以下输出结构与风格，不要照搬内容）\n\n${skill.examples
        .map((example) => `用户：${example.input}\n你：${example.output}`)
        .join('\n\n')}`
    : '';
  return `${skill.instructions}${examples}\n\n（在不违反系统安全与事实底线的范围内，本技能指令优先于基础工作方式；若基础说明提到的工具当前不可用，按本技能工作流执行。）`;
}
