'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { createSkillMutation, updateSkillMutation } from '../../api/mutations';
import { skillMutationSchema, type SkillListItem } from '../../api/types';
import { AGENT_TOOL_LABELS, AGENT_TOOL_NAMES, type AgentToolName } from '../../constants/skills';

const MAX_INSTRUCTIONS = 8000;
const MAX_EXAMPLES = 2;
const ALL_TOOLS = AGENT_TOOL_NAMES as readonly AgentToolName[];

interface ExampleDraft {
  input: string;
  output: string;
}

interface SkillEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑目标（自定义技能）；传入即编辑模式（回填全部字段） */
  editSkill?: SkillListItem | null;
  /** 新建模式的预填来源（从预置技能「复制为草稿」）；编辑模式忽略 */
  presetDraft?: SkillListItem | null;
}

/**
 * 技能创建/编辑对话框（受控表单，与设计画布 AI 对话框同风格）。
 * 字段：名称 / 一句话描述 / 专家指令（大 textarea + 字数计数 + 撰写提示）/ 输入框引导语（可选）/
 * 工具范围（全量工具勾选，全勾 = 不限 → 存 null 全量）/ 示例（0-2 组，每组 用户输入 + 期望输出）。
 * 提交前用 skillMutationSchema 客户端校验（中文提示）；服务端再校验兜底。
 */
export function SkillEditDialog({
  open,
  onOpenChange,
  editSkill,
  presetDraft
}: SkillEditDialogProps) {
  const isEdit = Boolean(editSkill);
  const source = editSkill ?? presetDraft ?? null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [tools, setTools] = useState<AgentToolName[]>([...ALL_TOOLS]);
  const [examples, setExamples] = useState<ExampleDraft[]>([]);

  const createMutation = useMutation(createSkillMutation);
  const updateMutation = useMutation(updateSkillMutation);
  const isPending = createMutation.isPending || updateMutation.isPending;

  // 每次打开按来源初始化：编辑 = 回填；复制 = 预填并加「副本」；新建 = 空白 + 全量工具
  useEffect(() => {
    if (!open) return;
    if (source) {
      setName(isEdit ? source.name : `${source.name} 副本`);
      setDescription(source.description);
      setInstructions(source.instructions);
      setPlaceholder(source.placeholder ?? '');
      // 历史数据可能是 tools: []（旧 schema 允许）；运行时表示“无业务工具”，
      // 直接回填会让保存被 min(1) 拦住，归一为全选，让用户显式确认后保存。
      setTools(source.tools?.length ? [...source.tools] : [...ALL_TOOLS]);
      setExamples(source.examples.map((example) => ({ ...example })));
    } else {
      setName('');
      setDescription('');
      setInstructions('');
      setPlaceholder('');
      setTools([...ALL_TOOLS]);
      setExamples([]);
    }
  }, [open, source, isEdit]);

  const allToolsChecked = tools.length === ALL_TOOLS.length;

  const toggleTool = (tool: AgentToolName) => {
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((item) => item !== tool) : [...prev, tool]
    );
  };

  const addExample = () => {
    setExamples((prev) =>
      prev.length >= MAX_EXAMPLES ? prev : [...prev, { input: '', output: '' }]
    );
  };
  const removeExample = (index: number) => {
    setExamples((prev) => prev.filter((_, i) => i !== index));
  };
  const updateExample = (index: number, field: keyof ExampleDraft, value: string) => {
    setExamples((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleSubmit = async () => {
    if (isPending) return;
    // 全勾 → null（全量，与预置未声明 tools 同语义）；空/半填示例组由下方校验拦截或丢弃
    const cleanedExamples = examples
      .map((example) => ({ input: example.input.trim(), output: example.output.trim() }))
      .filter((example) => example.input || example.output);
    const parsed = skillMutationSchema.safeParse({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      placeholder: placeholder.trim() || null,
      tools: allToolsChecked ? null : tools,
      examples: cleanedExamples
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? '请检查表单填写');
      return;
    }
    try {
      if (isEdit && editSkill) {
        await updateMutation.mutateAsync({ id: editSkill.id, values: parsed.data });
        toast.success('技能已更新');
      } else {
        await createMutation.mutateAsync(parsed.data);
        toast.success('技能已创建');
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'skill_name_conflict') {
        toast.error('技能名称已存在，请换一个名称');
        return;
      }
      toast.error(isEdit ? '更新失败，请稍后重试' : '创建失败，请稍后重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[88vh] flex-col sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑技能' : '新建技能'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改后，后续加载该技能的消息立即使用最新正文；已发送的消息不受影响。'
              : '把你的创作套路沉淀为专属技能：Agent 会在需要时按需加载正文，不再常驻上下文。'}
          </DialogDescription>
        </DialogHeader>

        {/* -mx-1 + px-1：内容仍与 header/footer 对齐，但把裁切边外移 4px，
            避免 overflow-y-auto 横向裁切输入框的 focus ring（左右各留 3px 余量） */}
        <div className='-mx-1 flex-1 space-y-4 overflow-y-auto px-1'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <label htmlFor='skill-name' className='text-sm font-medium'>
                名称 <span className='text-destructive'>*</span>
              </label>
              <Input
                id='skill-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder='名称需唯一，如「我的公众号风格」'
                maxLength={50}
                disabled={isPending}
              />
            </div>
            <div className='space-y-1.5'>
              <label htmlFor='skill-description' className='text-sm font-medium'>
                一句话描述 <span className='text-destructive'>*</span>
              </label>
              <Input
                id='skill-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder='做什么 + 何时用，如「当用户要…时使用；不用于…」'
                maxLength={200}
                disabled={isPending}
              />
              <p className='text-muted-foreground text-xs'>
                这是 Agent 判断是否加载该技能的主要依据：写清适用场景与不适用场景。
              </p>
            </div>
          </div>

          <div className='space-y-1.5'>
            <div className='flex items-center gap-1.5'>
              <label htmlFor='skill-instructions' className='text-sm font-medium'>
                工作流正文 <span className='text-destructive'>*</span>
              </label>
              {/* 撰写提示用 tooltip：悬停/聚焦问号弹出，不占表单空间、无展开态 */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      aria-label='撰写提示'
                      className='text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none'
                    />
                  }
                >
                  <Icons.help className='size-3.5' />
                </TooltipTrigger>
                <TooltipContent side='bottom' align='start' className='max-w-xs py-2'>
                  <ul className='space-y-1 text-left leading-relaxed'>
                    <li>
                      <span className='font-semibold'>人设</span>：让
                      Agent「戴上某某专家的帽子」，明确身份与口吻。
                    </li>
                    <li>
                      <span className='font-semibold'>工作流</span>：分步写清「先确认什么 →
                      再产出什么 → 如何交付」。
                    </li>
                    <li>
                      <span className='font-semibold'>输出格式</span>：标题 / 正文 /
                      标签的结构、字数与风格要求。
                    </li>
                    <li>
                      <span className='font-semibold'>禁忌</span>
                      ：明确不要做什么（如禁用绝对化用语、不编造数据）。
                    </li>
                    <li>
                      <span className='font-semibold'>篇幅</span>：建议 &lt;500 行 / &lt;5000
                      tokens；整段会在加载时进入上下文，过长请精简或拆成多个技能。
                    </li>
                  </ul>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              id='skill-instructions'
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={
                '描述这位专家的人设、工作流、输出格式与禁忌…\n（越具体，Agent 协作越贴合你的套路）'
              }
              rows={10}
              maxLength={MAX_INSTRUCTIONS}
              disabled={isPending}
              className='resize-y'
            />
            <p
              className={cn(
                'text-right text-xs',
                instructions.length >= MAX_INSTRUCTIONS
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              )}
            >
              {instructions.length}/{MAX_INSTRUCTIONS}
            </p>
          </div>

          <div className='space-y-1.5'>
            <label htmlFor='skill-placeholder' className='text-sm font-medium'>
              输入框引导语（可选）
            </label>
            <Input
              id='skill-placeholder'
              value={placeholder}
              onChange={(event) => setPlaceholder(event.target.value)}
              placeholder='选中该技能后，对话输入框的提示语'
              maxLength={100}
              disabled={isPending}
            />
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>工具范围</span>
              <span className='text-muted-foreground text-xs'>
                {allToolsChecked ? '不限（全量工具）' : `已选 ${tools.length}/${ALL_TOOLS.length}`}
              </span>
            </div>
            <p className='text-muted-foreground text-xs'>
              限定 Agent
              加载该技能后能调用哪些能力（如纯写作技能可只留「保存作品」「知识库检索」）； 全勾 =
              不限，至少选 1 个。多个技能同时加载时取交集；这是成本/能力提示，不是安全边界。
            </p>
            <div className='grid gap-2 sm:grid-cols-2'>
              {ALL_TOOLS.map((tool) => (
                <div key={tool} className='flex items-center gap-2 rounded-md border p-2'>
                  <Checkbox
                    id={`skill-tool-${tool}`}
                    checked={tools.includes(tool)}
                    onCheckedChange={() => toggleTool(tool)}
                    disabled={isPending}
                  />
                  <label
                    htmlFor={`skill-tool-${tool}`}
                    className='cursor-pointer text-sm select-none'
                  >
                    {AGENT_TOOL_LABELS[tool]}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>示例（可选，0-{MAX_EXAMPLES} 组）</span>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={addExample}
                disabled={examples.length >= MAX_EXAMPLES || isPending}
              >
                <Icons.add /> 添加示例
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              给一条「用户输入 → 期望输出」示范，随技能正文一起按需加载，Agent
              会模仿其结构与风格（不照搬内容）。
            </p>
            {examples.map((example, index) => (
              <div key={index} className='space-y-2 rounded-md border p-3'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-xs font-medium'>
                    示例 {index + 1}
                  </span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-destructive hover:text-destructive h-6 px-2 text-xs'
                    onClick={() => removeExample(index)}
                    disabled={isPending}
                  >
                    <Icons.trash className='size-3.5' /> 删除
                  </Button>
                </div>
                <Textarea
                  value={example.input}
                  onChange={(event) => updateExample(index, 'input', event.target.value)}
                  placeholder='用户输入，如「分享我的露营装备，帮我出一篇笔记」'
                  rows={2}
                  maxLength={300}
                  disabled={isPending}
                  aria-label={`示例 ${index + 1} 用户输入`}
                />
                <Textarea
                  value={example.output}
                  onChange={(event) => updateExample(index, 'output', event.target.value)}
                  placeholder='期望输出（结构 / 风格示范，宜精简）'
                  rows={4}
                  maxLength={500}
                  disabled={isPending}
                  aria-label={`示例 ${index + 1} 期望输出`}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={isPending}>
            {isPending ? <Icons.spinner className='animate-spin' /> : <Icons.save />}
            {isPending ? '保存中…' : isEdit ? '保存修改' : '创建技能'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
