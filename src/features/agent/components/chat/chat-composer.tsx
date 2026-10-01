'use client';

import dynamic from 'next/dynamic';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Icons } from '@/components/icons';
import { getAssetKindMeta } from '../../constants/kinds';
import { useSkillList } from '../../hooks/use-skill-list';
import type { ReferencedAsset } from '../../lib/asset-reference';
import { ModelSelector } from './model-selector';
import { SkillSelector } from './skill-selector';

/** 按需加载：不打开选择器就不下载弹窗 chunk（bundle-dynamic-imports） */
const AssetReferencePicker = dynamic(
  () => import('./asset-reference-picker').then((m) => m.AssetReferencePicker),
  { ssr: false }
);

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isGenerating: boolean;
  model: string;
  onModelChange: (value: string) => void;
  /** 会话级技能 id（null = 通用） */
  skillId: string | null;
  onSkillChange: (value: string | null) => void;
  /** 已引用的资产（展示为可移除 chip，提交时由 chat-window 注入机器可读块） */
  referencedAssets: ReferencedAsset[];
  onAddReference: (asset: ReferencedAsset) => void;
  onRemoveReference: (id: string) => void;
}

/** 输入区：模型选择 + 技能选择 + 引用资产 + 文本输入 + 发送/停止 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isGenerating,
  model,
  onModelChange,
  skillId,
  onSkillChange,
  referencedAssets,
  onAddReference,
  onRemoveReference
}: ChatComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isGenerating && value.trim()) {
        onSubmit();
      }
    }
  };

  // 首次打开后才挂载（挂载即触发 chunk 加载）；之后保持挂载以保留关闭动画
  const openPicker = () => {
    setPickerMounted(true);
    setPickerOpen(true);
  };

  // 已选引用但还没输入时，用 placeholder 引导下一步（否则发送禁用会让人以为按钮坏了）；
  // 无引用但技能激活时，用技能引导语（引用优先：它更贴近即将发送的这条消息）
  const { getById } = useSkillList();
  const skill = getById(skillId);
  const placeholder =
    referencedAssets.length > 0
      ? `想基于《${referencedAssets[0].title.replace(/\s+/g, ' ').trim()}》${
          referencedAssets.length > 1 ? `等 ${referencedAssets.length} 个资产` : ''
        }做什么？`
      : skill
        ? (skill.placeholder ?? `描述你的需求，「${skill.name}」将按专家套路与你协作…`)
        : '描述你的创作需求…（Enter 发送，Shift+Enter 换行）';

  return (
    <div className='shrink-0 border-t'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3'>
        {referencedAssets.length > 0 && (
          <ul className='flex flex-wrap gap-1.5' aria-label='已引用资产'>
            {referencedAssets.map((asset) => {
              const { label, icon: KindIcon } = getAssetKindMeta(asset.kind);
              return (
                <li
                  key={asset.id}
                  className='bg-muted flex max-w-full items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
                >
                  <KindIcon className='text-muted-foreground size-3.5 shrink-0' />
                  <span className='truncate font-medium'>{asset.title}</span>
                  <span className='text-muted-foreground shrink-0'>{label}</span>
                  <button
                    type='button'
                    onClick={() => onRemoveReference(asset.id)}
                    aria-label={`移除引用：${asset.title}`}
                    className='text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none'
                  >
                    <Icons.close className='size-3.5' />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          className='max-h-40 min-h-[3.25rem] resize-none'
        />
        <div className='flex items-center justify-between gap-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <ModelSelector value={model} onChange={onModelChange} disabled={isGenerating} />
            <SkillSelector value={skillId} onChange={onSkillChange} disabled={isGenerating} />
            <Button
              variant='outline'
              size='sm'
              onClick={openPicker}
              aria-label='引用资产'
              title='引用「我的资产」中的作品，让 Agent 基于它继续创作'
            >
              <Icons.paperclip />
              {/* 窄屏只留图标，避免与模型选择器、发送按钮挤在一行 */}
              <span className='hidden sm:inline'>引用资产</span>
            </Button>
          </div>
          {isGenerating ? (
            <Button variant='outline' size='sm' onClick={onStop}>
              <Icons.stop /> 停止
            </Button>
          ) : (
            <Button size='sm' onClick={onSubmit} disabled={!value.trim()}>
              <Icons.send /> 发送
            </Button>
          )}
        </div>
      </div>
      {pickerMounted && (
        <AssetReferencePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          referencedIds={referencedAssets.map((asset) => asset.id)}
          onPick={onAddReference}
        />
      )}
    </div>
  );
}
