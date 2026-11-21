/**
 * 技能引擎 —— 按需加载的「专家工作流包」的运行时逻辑：
 * system 里只常驻轻量目录（名称 + 何时用），模型判断任务匹配后调用 loadSkill
 * 读取完整正文（instructions + 示例），正文作为 tool result 进入消息历史；
 * 用户也可以对「某一条消息」显式指定技能（消息 metadata.skillId），服务端直接注入并限制工具边界。
 *
 * 技能数据只有一处来源：skills 表（按 userId 隔离，见 skill-service.ts）。
 * 代码内的示例只作为「模板」服务「从模板新建」的表单预填（constants/skill-templates.ts），
 * 不进入运行时目录——模板因此不会被自动路由，也不会以 tool result 形式覆盖基座指令。
 * id 为用户技能的 uuid，也是历史消息 / 续答回灌的解析依据；改名不影响已持久化的引用。
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
 * 工具中文名（技能表单的工具边界勾选用；与 AGENT_TOOL_NAMES 一一对应）。
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
  /** 技能 id（skills 表 uuid），存库与回灌用 */
  id: string;
  /** 展示名；同一用户内唯一（loadSkill 先按 id、再按名称解析） */
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

/**
 * 按引用解析技能：先精确匹配 id（稳定 key），再按展示名（trim + 大小写不敏感）。
 * 名称在「当前用户的技能」范围内唯一（写入时由 skill-service 校验），不会产生歧义。
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
      ? `\n（另有 ${skills.length - MAX_CATALOG_SKILLS} 个技能未在目录中；目录最多 ${MAX_CATALOG_SKILLS} 个，可在技能管理页精简技能数量。）`
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
