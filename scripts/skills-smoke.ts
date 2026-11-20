/* oxlint-disable no-console */
/**
 * 技能契约冒烟脚本：校验预置技能注册表、目录渲染、引用解析与 mutation schema。
 * 运行：bun run skills:check
 * 可选：配置 DATABASE_URL 时，额外检查「新增预置是否会与已有用户自定义技能重名 / 重 id」；
 * 配置了但连接 / 查询失败会按失败退出——只想跑静态检查时请临时 unset DATABASE_URL。
 *
 * 预置 id 是事实上的 public API（历史消息 metadata.skillId / 续答回灌都依赖它），
 * 因此用快照锁住 id：增删预置时必须同步更新下面的快照，让变更在 review 中被看到。
 */
import {
  AGENT_TOOL_NAMES,
  MAX_CATALOG_SKILLS,
  PRESET_SKILLS,
  SKILL_IDS,
  computeActiveTools,
  findSkillByRef,
  isPresetSkillId,
  isReservedSkillName,
  renderSkillBody,
  renderSkillCatalog,
  type SkillRegistryEntry
} from '../src/features/agent/constants/skills';
import { skillMutationSchema, toCatalogItem } from '../src/features/agent/api/types';

/** 预置 id 快照：只增不改；改名可以，改 id 必须走兼容性评估。 */
const PRESET_ID_SNAPSHOT = ['ecommerce-imagery', 'xiaohongshu', 'general-creation'];

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
// 1. 预置注册表：id / 名称 / 字段约束
// ---------------------------------------------------------------------------

check(
  '预置 id 快照未变化（id 是 public API，只增不改）',
  JSON.stringify(SKILL_IDS) === JSON.stringify(PRESET_ID_SNAPSHOT),
  `实际 ${JSON.stringify(SKILL_IDS)}`
);

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
for (const skill of PRESET_SKILLS) {
  const label = `预置「${skill.name}」`;
  check(
    `${label} id 符合 Agent Skills 规范（1-64 位小写字母/数字/连字符）`,
    skill.id.length >= 1 && skill.id.length <= 64 && slugPattern.test(skill.id),
    skill.id
  );
  check(
    `${label} description 长度 1-200 且无换行`,
    skill.description.trim().length >= 1 &&
      skill.description.length <= 200 &&
      !/[\r\n]/.test(skill.description)
  );
  check(
    `${label} description 包含触发语义（使用 / 适用 / 用于）`,
    /使用|适用|用于/.test(skill.description),
    skill.description
  );
  check(
    `${label} instructions 长度 1-8000`,
    skill.instructions.trim().length >= 1 && skill.instructions.length <= 8000
  );
  check(
    `${label} placeholder 不超过 100 字`,
    !skill.placeholder || skill.placeholder.length <= 100
  );
  check(
    `${label} examples 最多 2 条且字段长度合规`,
    (skill.examples ?? []).length <= 2 &&
      (skill.examples ?? []).every(
        (example) =>
          example.input.trim().length >= 1 &&
          example.input.length <= 300 &&
          example.output.trim().length >= 1 &&
          example.output.length <= 500
      )
  );
  check(
    `${label} tools 要么未声明，要么非空且全部是合法工具名`,
    !skill.tools ||
      (skill.tools.length >= 1 && skill.tools.every((tool) => AGENT_TOOL_NAMES.includes(tool)))
  );

  const body = renderSkillBody(skill);
  check(`${label} renderSkillBody 包含完整正文`, body.includes(skill.instructions));
  check(`${label} renderSkillBody 带安全边界声明`, body.includes('不违反系统安全与事实底线'));
}

const normalizedNames = PRESET_SKILLS.map((skill) => skill.name.trim().toLocaleLowerCase());
check(
  '预置名称在注册表内唯一（trim + 大小写不敏感）',
  new Set(normalizedNames).size === normalizedNames.length,
  normalizedNames.join(', ')
);
check(
  'isPresetSkillId 能识别预置、拒绝自定义 id',
  isPresetSkillId(PRESET_SKILLS[0].id) && !isPresetSkillId('00000000-0000-0000-0000-000000000000')
);
check(
  'isReservedSkillName 拦截预置名称与预置 id',
  isReservedSkillName(PRESET_SKILLS[0].name) && isReservedSkillName(PRESET_SKILLS[0].id)
);
check('isReservedSkillName 放行普通自定义名称', !isReservedSkillName('我的小红书风格'));

// ---------------------------------------------------------------------------
// 2. 引用解析与目录渲染
// ---------------------------------------------------------------------------

function presetById(id: string): SkillRegistryEntry {
  const found = PRESET_SKILLS.find((skill) => skill.id === id);
  if (!found) throw new Error(`未找到预置技能 ${id}`);
  return found;
}

const first = PRESET_SKILLS[0];
check('findSkillByRef 按 id 解析', findSkillByRef(PRESET_SKILLS, first.id)?.id === first.id);
check(
  'findSkillByRef 按名称解析（trim + 大小写不敏感）',
  findSkillByRef(PRESET_SKILLS, ` ${first.name.toLocaleUpperCase()} `)?.id === first.id
);
check(
  'findSkillByRef 未知引用返回 undefined',
  findSkillByRef(PRESET_SKILLS, '不存在的技能') === undefined
);

const duplicateA: SkillRegistryEntry = { ...first, id: 'custom-a', name: '同名技能' };
const duplicateB: SkillRegistryEntry = { ...first, id: 'custom-b', name: '同名技能' };
check(
  '同名时按传入顺序优先（路由侧自定义在前）',
  findSkillByRef([duplicateA, duplicateB], '同名技能')?.id === 'custom-a'
);

const catalog = renderSkillCatalog(PRESET_SKILLS);
check(
  '目录包含全部预置名称',
  PRESET_SKILLS.every((skill) => catalog.includes(`- ${skill.name}：`))
);
check('目录不产生溢出提示', !catalog.includes('未在目录中'));

const manySkills: SkillRegistryEntry[] = Array.from(
  { length: MAX_CATALOG_SKILLS + 2 },
  (_, index) => ({
    id: `test-skill-${index}`,
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
check('目录溢出时提示剩余数量', overflowCatalog.includes('另有 2 个技能未在目录中'));

const catalogItem = toCatalogItem(first, 'builtin', null);
check(
  'toCatalogItem 映射完整且预置无更新时间',
  catalogItem.id === first.id &&
    catalogItem.name === first.name &&
    catalogItem.description === first.description &&
    catalogItem.source === 'builtin' &&
    catalogItem.updatedAt === null
);

// ---------------------------------------------------------------------------
// 3. 工具边界：交集语义
// ---------------------------------------------------------------------------

const ecommerce = presetById('ecommerce-imagery');
const general = presetById('general-creation');
const withGeneral = computeActiveTools([ecommerce, general]);
check(
  '工具边界取交集：电商 + 通用仍禁用视频',
  withGeneral !== null &&
    withGeneral.includes('createImageAsset') &&
    !withGeneral.includes('createVideoAsset')
);
check('未声明 tools 的技能单独加载 = 不限制', computeActiveTools([general]) === null);
check('未加载技能 = 不限制', computeActiveTools([]) === null);

const toolA: SkillRegistryEntry = {
  ...ecommerce,
  id: 'test-tool-a',
  tools: ['createAsset', 'createImageAsset']
};
const toolB: SkillRegistryEntry = {
  ...ecommerce,
  id: 'test-tool-b',
  tools: ['createAsset', 'knowledgeSearch']
};
const intersection = computeActiveTools([toolA, toolB]);
check(
  '多个声明工具的技能取交集',
  intersection !== null && intersection.length === 1 && intersection[0] === 'createAsset'
);
const emptyTools = computeActiveTools([{ ...ecommerce, tools: [] }]);
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

// ---------------------------------------------------------------------------
// 5. 可选：数据库名称冲突检查（新增预置不得遮蔽用户自定义技能）
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.log('[skip] 未设置 DATABASE_URL，跳过数据库名称冲突检查');
} else {
  try {
    const { getDb } = await import('../src/lib/db/index');
    const { skills } = await import('../src/lib/db/schema');
    const rows = await getDb().select({ name: skills.name }).from(skills);
    const presetNames = new Set(normalizedNames);
    const presetIds = new Set(SKILL_IDS.map((id) => id.toLocaleLowerCase()));
    const collisions = [
      ...new Set(
        rows
          .map((row) => row.name.trim())
          .filter((name) => {
            const normalized = name.toLocaleLowerCase();
            return presetNames.has(normalized) || presetIds.has(normalized);
          })
      )
    ];
    check(
      '新增预置未与用户自定义技能重名 / 重 id（避免 loadSkill 被预置遮蔽）',
      collisions.length === 0,
      collisions.join(', ')
    );
  } catch (error) {
    failed += 1;
    console.error(
      `[fail] 数据库名称冲突检查执行失败：${error instanceof Error ? error.message : error}（如只想跑静态检查，请临时 unset DATABASE_URL）`
    );
  }
}

console.log(failed === 0 ? '\n技能契约检查全部通过。' : `\n${failed} 项技能契约检查失败。`);
process.exit(failed === 0 ? 0 : 1);
