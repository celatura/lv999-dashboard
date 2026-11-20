'use client';

import dynamic from 'next/dynamic';
import { useRef, useState, type KeyboardEvent } from 'react';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle
} from '@/components/ui/attachment';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group';
import { LoadingButton } from '@/components/ui/loading-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icons } from '@/components/icons';
import { getAssetKindMeta } from '../../constants/kinds';
import { ACCEPTED_ATTACHMENT_MIMES } from '../../constants/limits';
import { useSkillCatalog } from '../../hooks/use-skill-catalog';
import { imageThumbnailUrl } from '../../lib/asset-url';
import type { ReferencedAsset } from '../../lib/asset-reference';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  type ChatAttachment,
  type SkillCatalogItem,
  type SkillSelection
} from '../../api/types';
import { ModelSelector } from './model-selector';
import { SkillPicker } from './skill-picker';

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
  isStopping: boolean;
  canStop: boolean;
  controlsDisabled: boolean;
  model: string;
  onModelChange: (value: string) => void;
  /** 本条消息指定的技能（null = 自动匹配）；发送后由父层清空 */
  skill: SkillSelection | null;
  onSelectSkill: (skill: SkillCatalogItem) => void;
  onClearSkill: () => void;
  /** 已引用的资产（展示为可移除 chip，提交时由 chat-window 注入机器可读块） */
  referencedAssets: ReferencedAsset[];
  onAddReference: (asset: ReferencedAsset) => void;
  onRemoveReference: (id: string) => void;
  /** 图片附件（已上传资产，提交时作为 file parts 发送） */
  attachments: ChatAttachment[];
  /** 进行中的附件上传数（渲染占位 + 禁止发送） */
  uploadingCount: number;
  /** 当前模型是否支持图片输入（注册表 capabilities.multimodal） */
  visionSupported: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (assetId: string) => void;
}

/** 输入区：引用资产 + 本条消息技能 + 图片附件 + 模型选择 + 文本输入 + 发送/停止 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isGenerating,
  isStopping,
  canStop,
  controlsDisabled,
  model,
  onModelChange,
  skill,
  onSelectSkill,
  onClearSkill,
  referencedAssets,
  onAddReference,
  onRemoveReference,
  attachments,
  uploadingCount,
  visionSupported,
  onAddFiles,
  onRemoveAttachment
}: ChatComposerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMounted, setPickerMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isGenerating && !controlsDisabled && (value.trim() || attachments.length > 0)) {
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
  // 无引用但技能已指定时，用技能引导语（引用优先：它更贴近即将发送的这条消息）
  const { getById } = useSkillCatalog();
  const skillMeta = getById(skill?.id);
  const placeholder =
    referencedAssets.length > 0
      ? `想基于《${referencedAssets[0].title.replace(/\s+/g, ' ').trim()}》${
          referencedAssets.length > 1 ? `等 ${referencedAssets.length} 个资产` : ''
        }做什么？`
      : skill
        ? (skillMeta?.placeholder ?? `描述你的需求，「${skill.name}」将按专家套路与你协作…`)
        : '描述你的创作需求…';

  // 「+」菜单里图片项的可用性与禁用原因（菜单里没有 title 提示，需内联说明）
  const atAttachmentLimit = attachments.length + uploadingCount >= MAX_ATTACHMENTS_PER_MESSAGE;
  const canAddImages = visionSupported && !isGenerating && !controlsDisabled && !atAttachmentLimit;
  const imageBlockedReason = !visionSupported
    ? '当前模型不支持图片输入，请切换多模态模型'
    : atAttachmentLimit
      ? `图片附件已达上限（${MAX_ATTACHMENTS_PER_MESSAGE} 张）`
      : null;

  return (
    <div className='bg-background shrink-0 pt-2 pb-4'>
      <div className='mx-auto w-full max-w-3xl px-4'>
        {/* has-disabled:* 覆盖：InputGroup 基础样式按「内部有禁用控件」给整组置灰，
            但这里被禁用常驻的是发送/模型等按钮而非输入框，空输入时整组会被误置灰并降透明度 */}
        <InputGroup className='bg-card dark:bg-card has-disabled:bg-card has-disabled:opacity-100 dark:has-disabled:bg-card rounded-2xl shadow-sm'>
          {(attachments.length > 0 || uploadingCount > 0) && (
            <InputGroupAddon align='block-start' className='px-3 pt-2'>
              <AttachmentGroup aria-label='图片附件'>
                {attachments.map((attachment) => (
                  <Attachment key={attachment.assetId} size='sm' state='done'>
                    <AttachmentMedia variant='image'>
                      {/* oxlint-disable-next-line nextjs/no-img-element -- 同源 /raw 代理缩略图（OSS 等比缩放），不经图片优化器 */}
                      <img src={imageThumbnailUrl(attachment.assetId)} alt={attachment.filename} />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{attachment.filename}</AttachmentTitle>
                    </AttachmentContent>
                    <AttachmentActions>
                      <AttachmentAction
                        aria-label={`移除附件：${attachment.filename}`}
                        onClick={() => onRemoveAttachment(attachment.assetId)}
                      >
                        <Icons.close />
                      </AttachmentAction>
                    </AttachmentActions>
                  </Attachment>
                ))}
                {Array.from({ length: uploadingCount }).map((_, index) => (
                  <Attachment key={`uploading-${index}`} size='sm' state='uploading'>
                    <AttachmentMedia>
                      <Icons.spinner className='animate-spin' />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>上传中…</AttachmentTitle>
                    </AttachmentContent>
                  </Attachment>
                ))}
              </AttachmentGroup>
            </InputGroupAddon>
          )}
          {skill && (
            <InputGroupAddon align='block-start' className='px-3 pt-2'>
              <div className='flex w-full min-w-0 items-center gap-1.5 text-xs'>
                <span className='text-muted-foreground shrink-0'>技能</span>
                <span
                  title='仅本条消息生效，发送后自动清除'
                  className='bg-primary/10 text-primary flex min-w-0 max-w-full items-center gap-1 rounded-md py-1 pr-1 pl-2 text-xs'
                >
                  <Icons.sparkles className='size-3.5 shrink-0' />
                  <span className='truncate font-medium'>{skill.name}</span>
                  <button
                    type='button'
                    onClick={onClearSkill}
                    aria-label={`清除技能：${skill.name}`}
                    className='hover:bg-primary/15 focus-visible:ring-ring shrink-0 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none'
                  >
                    <Icons.close className='size-3.5' />
                  </button>
                </span>
              </div>
            </InputGroupAddon>
          )}
          {referencedAssets.length > 0 && (
            <InputGroupAddon align='block-start' className='px-3 pt-2'>
              <div className='flex w-full flex-col gap-1.5'>
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
                {referencedAssets.some((asset) => asset.kind === 'image') && (
                  <p className='text-muted-foreground text-xs'>
                    图片可用于修改或生成视频，但 Agent 不能直接看到图片内容；请用文字描述关键信息。
                  </p>
                )}
              </div>
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            aria-label='创作需求'
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              // 粘贴图片直接上传为附件（chatbot 同款交互）；纯文本粘贴不受影响
              const images = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/')
              );
              if (images.length > 0) {
                event.preventDefault();
                onAddFiles(images);
              }
            }}
            placeholder={placeholder}
            rows={2}
            className='max-h-[min(10rem,25dvh)] min-h-[3.25rem] resize-none px-3 py-3'
          />
          <InputGroupAddon align='block-end' className='flex-wrap gap-1 px-3 pt-0 pb-2'>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={<InputGroupButton size='icon-sm' aria-label='添加引用资产或图片' />}
                    />
                  }
                >
                  <Icons.add />
                </TooltipTrigger>
                <TooltipContent>引用资产或上传图片</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align='start' side='top' className='w-56'>
                <DropdownMenuItem onClick={openPicker}>
                  <Icons.paperclip className='text-muted-foreground' />
                  引用我的资产…
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canAddImages}
                >
                  <Icons.media className='text-muted-foreground' />
                  上传图片
                </DropdownMenuItem>
                {imageBlockedReason && (
                  <p className='text-muted-foreground px-1.5 pt-1 text-xs leading-relaxed'>
                    {imageBlockedReason}
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ModelSelector
              value={model}
              onChange={onModelChange}
              disabled={isGenerating || controlsDisabled}
            />
            <SkillPicker
              value={skill}
              onSelect={onSelectSkill}
              onClear={onClearSkill}
              disabled={isGenerating || controlsDisabled}
            />
            <input
              ref={fileInputRef}
              type='file'
              accept={ACCEPTED_ATTACHMENT_MIMES.join(',')}
              multiple
              className='hidden'
              aria-hidden='true'
              tabIndex={-1}
              onChange={(event) => {
                if (event.target.files?.length) {
                  onAddFiles(Array.from(event.target.files));
                }
                event.target.value = '';
              }}
            />
            {isGenerating ? (
              <LoadingButton
                variant='outline'
                size='icon'
                className='ml-auto rounded-full'
                onClick={onStop}
                disabled={!canStop}
                loading={isStopping}
                loadingLabel='正在停止生成'
                aria-label='停止生成'
                title={canStop ? '停止后已发起的生成仍可能产生费用' : '正在建立生成，请稍候'}
              >
                <Icons.stop />
              </LoadingButton>
            ) : (
              <Button
                size='icon'
                className='ml-auto rounded-full'
                onClick={onSubmit}
                disabled={(!value.trim() && attachments.length === 0) || controlsDisabled}
                aria-label='发送'
                title='Enter 发送，Shift+Enter 换行'
              >
                <Icons.send />
              </Button>
            )}
          </InputGroupAddon>
        </InputGroup>
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
