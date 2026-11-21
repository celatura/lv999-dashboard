'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Icons } from '@/components/icons';
import { SKILL_TEMPLATES, type SkillTemplate } from '../../constants/skill-templates';

/** 对话框按需加载：未点击就不下载该 chunk（bundle-dynamic-imports，与新增文档同策略） */
const SkillEditDialog = dynamic(
  () => import('./skill-edit-dialog').then((module) => module.SkillEditDialog),
  { ssr: false }
);

/**
 * 技能管理页头部操作：「新建技能」（空白）+「从模板新建」（下拉）。
 * 模板只做表单预填、不落库、不进入运行时目录（见 constants/skill-templates.ts）。
 */
export function CreateSkillButton() {
  const [open, setOpen] = useState(false);
  // 首次点击后才挂载（挂载即触发 chunk 加载）；之后保持挂载以保留关闭动画
  const [mounted, setMounted] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<SkillTemplate | null>(null);

  const openDialog = (template: SkillTemplate | null) => {
    setMounted(true);
    setTemplateDraft(template);
    setOpen(true);
  };

  return (
    <>
      <div className='flex items-center gap-2'>
        <Button onClick={() => openDialog(null)}>
          <Icons.add />
          新建技能
        </Button>
        {SKILL_TEMPLATES.length > 0 && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger render={<Button variant='outline' />}>
              <Icons.copy />
              从模板新建
              <Icons.chevronDown className='opacity-60' />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {SKILL_TEMPLATES.map((template) => (
                <DropdownMenuItem key={template.key} onClick={() => openDialog(template)}>
                  {template.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {mounted && (
        <SkillEditDialog open={open} onOpenChange={setOpen} templateDraft={templateDraft} />
      )}
    </>
  );
}
