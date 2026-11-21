/* oxlint-disable no-console */
/**
 * 技能契约冒烟脚本：校验技能引擎（引用解析 / 目录渲染 / 工具边界）、mutation schema 与技能模板。
 * 运行：bun run skills:check
 *
 * 模板只服务「从模板新建」的表单预填、不进入运行时，因此这里校验的是
 * 「模板转成 payload 后必须能通过 skillMutationSchema」——保证一键新建不会因字段超限失败。
 * 脚本为纯静态检查，不依赖数据库。
 */
import {
  AGENT_TOOL_NAMES,
  MAX_CATALOG_SKILLS,
  computeActiveTools,
  findSkillByRef,
  renderSkillBody,
  renderSkillCatalog,
  type SkillRegistryEntry
} from '../src/features/agent/constants/skills';
import { SKILL_TEMPLATES } from '../src/features/agent/constants/skill-templates';
import { skillMutationSchema } from '../src/features/agent/api/types';

let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`[ok] ${name}`);
    return;
  }
  failed += 1;
  console.error(`[fail] ${name}${detail ? `：${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. 引用解析
// ---------------------------------------------------------------------------

const base: SkillRegistryEntry = {
  id: '11111111-1111-1111-1111-111111111111',
  // 名称含拉丁字母，才能真实验证解析的「大小写不敏感」
  name: 'Sample 技能',
  description: '当用户要测试时使用',
  instructions: '测试指令'
};

check('findSkillByRef 按 id 解析', findSkillByRef([base], base.id)?.id === base.id);
check(
  'findSkillByRef 按名称解析（trim + 大小写不敏感）',
  findSkillByRef([base], ` ${base.name.toLocaleUpperCase()} `)?.id === base.id
);
check(
  'findSkillByRef 未知引用返回 undefined',
  findSkillByRef([base], '不存在的技能') === undefined
);

const duplicateA: SkillRegistryEntry = { ...base, id: 'custom-a', name: '同名技能' };
const duplicateB: SkillRegistryEntry = { ...base, id: 'custom-b', name: '同名技能' };
check(
  '同名时按传入顺序优先（写入侧已保证唯一，此处仅锁定解析语义）',
  findSkillByRef([duplicateA, duplicateB], '同名技能')?.id === 'custom-a'
);

// ---------------------------------------------------------------------------
// 2. 目录渲染
// ---------------------------------------------------------------------------

check('无技能时不渲染目录段落', renderSkillCatalog([]) === '');

const catalog = renderSkillCatalog([base]);
check('目录包含技能名称与描述', catalog.includes(`- ${base.name}：${base.description}`));

const manySkills: SkillRegistryEntry[] = Array.from(
  { length: MAX_CATALOG_SKILLS + 2 },
  (_, index) => ({
    id: `skill-${index}`,
    name: `技能${String.fromCharCode(65 + index)}`,
    description: '测试技能描述',
    instructions: '测试技能指令'
  })
);
const overflowCatalog = renderSkillCatalog(manySkills);
check(
  `目录最多渲染 ${MAX_CATALOG_SKILLS} 个技能`,
  overflowCatalog.includes(`- 技能${String.fromCharCode(65)}：`) &&
    !overflowCatalog.includes(`- 技能${String.fromCharCode(65 + MAX_CATALOG_SKILLS)}：`)
);
check('目录溢出时提示剩余数量与处理方式', overflowCatalog.includes('另有 2 个技能未在目录中'));

// ---------------------------------------------------------------------------
// 3. 正文渲染与工具边界
// ---------------------------------------------------------------------------

const withExample: SkillRegistryEntry = {
  ...base,
  examples: [{ input: '测试输入', output: '测试输出' }]
};
check('renderSkillBody 包含完整正文', renderSkillBody(base).includes(base.instructions));
check('renderSkillBody 带安全边界声明', renderSkillBody(base).includes('不违反系统安全与事实底线'));
check(
  'renderSkillBody 带示范段落',
  renderSkillBody(withExample).includes('## 示范') &&
    renderSkillBody(base).includes('## 示范') === false
);

const imageOnly: SkillRegistryEntry = {
  ...base,
  tools: ['createAsset', 'createImageAsset']
};
const imageAndKnowledge: SkillRegistryEntry = {
  ...base,
  id: 'custom-b',
  tools: ['createAsset', 'knowledgeSearch']
};
check('未加载技能 = 不限制', computeActiveTools([]) === null);
check('未声明 tools 的技能单独加载 = 不限制', computeActiveTools([base]) === null);
const intersection = computeActiveTools([imageOnly, imageAndKnowledge]);
check(
  '多个声明工具的技能取交集',
  intersection !== null && intersection.length === 1 && intersection[0] === 'createAsset'
);
check(
  '声明了 tools 的技能不会因此放宽全量工具',
  computeActiveTools([imageOnly]) !== null &&
    !computeActiveTools([imageOnly])!.includes('createVideoAsset')
);
const emptyTools = computeActiveTools([{ ...base, tools: [] }]);
check(
  '空 tools 数组按无业务工具处理（旧数据不视为全量）',
  emptyTools !== null && emptyTools.length === 0
);

// ---------------------------------------------------------------------------
// 4. mutation schema：工具集与字段边界
// ---------------------------------------------------------------------------

const validPayload = {
  name: '测试技能',
  description: '当用户要测试时使用',
  instructions: '测试指令',
  placeholder: null,
  tools: null,
  examples: []
};
check(
  'skillMutationSchema 接受全量工具（tools: null）',
  skillMutationSchema.safeParse(validPayload).success
);
check(
  'skillMutationSchema 接受非空工具白名单',
  skillMutationSchema.safeParse({ ...validPayload, tools: ['createAsset'] }).success
);
check(
  'skillMutationSchema 拒绝空工具集（避免技能禁用全部业务工具）',
  !skillMutationSchema.safeParse({ ...validPayload, tools: [] }).success
);
check(
  'skillMutationSchema 拒绝非法工具名',
  !skillMutationSchema.safeParse({ ...validPayload, tools: ['not-a-tool'] }).success
);
check(
  'skillMutationSchema 拒绝超长 description',
  !skillMutationSchema.safeParse({ ...validPayload, description: 'x'.repeat(201) }).success
);
check(
  'skillMutationSchema 拒绝超过 2 条示例',
  !skillMutationSchema.safeParse({
    ...validPayload,
    examples: Array.from({ length: 3 }, () => ({ input: '输入', output: '输出' }))
  }).success
);

// ---------------------------------------------------------------------------
// 5. 技能模板：可一键新建（转 payload 必须通过 schema）
// ---------------------------------------------------------------------------

check('至少提供一个技能模板', SKILL_TEMPLATES.length >= 1);
const templateKeys = SKILL_TEMPLATES.map((template) => template.key);
check('模板 key 唯一', new Set(templateKeys).size === templateKeys.length, templateKeys.join(', '));
const templateNames = SKILL_TEMPLATES.map((template) => template.name.trim().toLocaleLowerCase());
check(
  '模板名称唯一（trim 后比较）',
  new Set(templateNames).size === templateNames.length,
  templateNames.join(', ')
);

for (const template of SKILL_TEMPLATES) {
  const label = `模板「${template.name}」`;
  const { key: _key, ...rest } = template;
  const payload = {
    ...rest,
    placeholder: rest.placeholder ?? null,
    tools: rest.tools ? [...rest.tools] : null,
    examples: [...(rest.examples ?? [])]
  };
  const parsed = skillMutationSchema.safeParse(payload);
  check(
    `${label} 可一键新建（payload 通过 skillMutationSchema）`,
    parsed.success,
    parsed.success ? '' : parsed.error.issues[0]?.message
  );
  check(
    `${label} description 包含触发语义（使用 / 适用 / 用于）`,
    /使用|适用|用于/.test(template.description),
    template.description
  );
  check(
    `${label} tools 非空且全部是合法工具名`,
    Boolean(template.tools?.length) &&
      (template.tools ?? []).every((tool) => AGENT_TOOL_NAMES.includes(tool))
  );
}

console.log(failed === 0 ? '\n技能契约检查全部通过。' : `\n${failed} 项技能契约检查失败。`);
process.exit(failed === 0 ? 0 : 1);
