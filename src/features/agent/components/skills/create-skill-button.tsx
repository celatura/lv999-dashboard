'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';

/** 对话框按需加载：未点击「新建技能」就不下载该 chunk（bundle-dynamic-imports，与新增文档同策略） */
const SkillEditDialog = dynamic(
  () => import('./skill-edit-dialog').then((module) => module.SkillEditDialog),
  { ssr: false }
);

/** 技能管理页头部的「新建技能」按钮（自带创建模式对话框） */
export function CreateSkillButton() {
  const [open, setOpen] = useState(false);
  // 首次点击后才挂载（挂载即触发 chunk 加载）；之后保持挂载以保留关闭动画
  const [mounted, setMounted] = useState(false);

  return (
    <>
      <Button
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <Icons.add />
        新建技能
      </Button>
      {mounted && <SkillEditDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
