'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyText } from '../lib/clipboard';

/** ✓ 态停留时长：够看清反馈，又不至于让人以为按钮换了功能 */
const COPIED_RESET_MS = 1500;

interface CopyButtonProps extends Omit<ComponentProps<typeof Button>, 'children' | 'onClick'> {
  /** 待复制的原文（消息为 Markdown 源码，资产为 content）；空串时按钮禁用 */
  text: string;
  /** 图标旁显示「复制 / 已复制」文字（资产预览头部用）；默认纯图标（消息操作栏用） */
  withLabel?: boolean;
}

/**
 * 复制按钮：clipboard 写入 + ✓ 态 + toast 反馈，供消息操作栏与资产预览共用。
 *
 * copied 态刻意自持在本组件内部：MessageItem 是 memo 化的（Streamdown 解析成本高），
 * 若把该态提到父层再经 props 传回，任一条消息的复制都会击穿 memo、重渲染整个列表。
 */
export function CopyButton({
  text,
  withLabel = false,
  disabled = false,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载（切会话 / 关弹窗）时清掉复位定时器，避免对已卸载组件 setState
  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    // 不静默失败：权限被拒且 execCommand 兜底也不可用时明示，用户改用手动选择
    if (!(await copyText(text))) {
      toast.error('复制失败，请手动选择文本');
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    toast.success('已复制到剪贴板');
  };

  const button = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled || text.length === 0}
      aria-label={copied ? '已复制' : '复制内容'}
      onClick={() => {
        void handleCopy();
      }}
      {...props}
    >
      {copied ? <Icons.check /> : <Icons.copy />}
      {withLabel && <span>{copied ? '已复制' : '复制'}</span>}
    </Button>
  );

  // 纯图标按钮（消息操作栏）语义不可见，补一条 tooltip；带文案的（资产预览头部）本身已说明用途，不再叠提示
  if (withLabel) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{copied ? '已复制' : '复制'}</TooltipContent>
    </Tooltip>
  );
}
