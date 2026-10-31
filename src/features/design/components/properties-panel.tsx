'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Icons, type Icon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { DesignObject, DesignObjectType, TextAlign } from '../api/types';
import { CANVAS_PRESETS, FILL_SWATCHES, FONT_SIZE_PRESETS } from '../constants/canvas';
import type { ObjectPatch, ObjectPatchEntry } from '../hooks/use-editor-reducer';
import { objectBounds, unionBox } from '../lib/document';
import { useEditor } from '../lib/editor-context';
import { AiEditDialog } from './ai-edit-dialog';

/**
 * 右侧属性面板 + 图层列表。
 * - 选中对象：填充色 / 字号（文字）/ **AI 修改（图片）** / 层级前后 / 删除；
 * - 未选中：画布背景色 + 尺寸预设；
 * - 图层列表：把画布对象镜像为 HTML 按钮（canvas 对辅助技术不可见），
 *   支持键盘聚焦与选择，满足可达性要求。
 */

const OBJECT_TYPE_META: Record<DesignObjectType, { label: string; icon: Icon }> = {
  rect: { label: '矩形', icon: Icons.square },
  circle: { label: '圆形', icon: Icons.circle },
  text: { label: '文字', icon: Icons.text },
  image: { label: '图片', icon: Icons.media }
};

/**
 * 文字水平对齐选项（Konva Text align）。
 * align 仅在文字设了换行宽度 width 时可见生效，故无 width 的自由文字不展示该组
 * （AI 整版产出的标题/副标题均带 width，可在此调整对齐）。
 */
const TEXT_ALIGN_OPTIONS: { value: TextAlign; label: string }[] = [
  { value: 'left', label: '左' },
  { value: 'center', label: '中' },
  { value: 'right', label: '右' }
];

function Swatches({
  value,
  onPick,
  label
}: {
  value: string;
  onPick: (color: string) => void;
  label: string;
}) {
  return (
    <div className='flex flex-wrap gap-1.5' role='group' aria-label={label}>
      {FILL_SWATCHES.map((color) => (
        <button
          key={color}
          type='button'
          title={color}
          aria-label={`${label} ${color}`}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          onClick={() => onPick(color)}
          className={cn(
            'border-border size-6 rounded-md border transition-transform hover:scale-110',
            value.toLowerCase() === color.toLowerCase() && 'ring-ring ring-2 ring-offset-1'
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function ObjectProperties({ object }: { object: DesignObject }) {
  const { commitObject, removeObject, reorder } = useEditor();
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const meta = OBJECT_TYPE_META[object.type];
  const fill = object.type === 'image' ? null : object.fill;
  // 单选图片对象才提供「AI 修改」（以其 assetId 为源走 I2I）
  const image = object.type === 'image' ? object : null;

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-2'>
        <span className='flex items-center gap-1.5 text-sm font-medium'>
          <meta.icon className='text-muted-foreground size-4' />
          {meta.label}
        </span>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='删除对象'
          onClick={() => removeObject(object.id)}
          className='text-destructive hover:text-destructive'
        >
          <Icons.trash />
        </Button>
      </div>

      {image && (
        <div className='space-y-1.5'>
          <span className='text-muted-foreground text-xs'>AI</span>
          <Button
            variant='outline'
            size='sm'
            className='w-full'
            onClick={() => setAiEditOpen(true)}
          >
            <Icons.sparkles /> AI 修改
          </Button>
        </div>
      )}

      {fill !== null && (
        <div className='space-y-1.5'>
          <span className='text-muted-foreground text-xs'>填充色</span>
          <Swatches
            value={fill}
            onPick={(color) => commitObject(object.id, { fill: color })}
            label='填充色'
          />
        </div>
      )}

      {object.type === 'text' && (
        <div className='space-y-1.5'>
          <span className='text-muted-foreground text-xs'>字号</span>
          <div className='flex flex-wrap gap-1.5'>
            {FONT_SIZE_PRESETS.map((size) => (
              <Button
                key={size}
                variant={object.fontSize === size ? 'secondary' : 'outline'}
                size='xs'
                onClick={() => commitObject(object.id, { fontSize: size })}
              >
                {size}
              </Button>
            ))}
          </div>
        </div>
      )}

      {object.type === 'text' && object.width !== undefined && (
        <div className='space-y-1.5'>
          <span className='text-muted-foreground text-xs'>对齐</span>
          <div className='grid grid-cols-3 gap-1.5' role='group' aria-label='文字对齐'>
            {TEXT_ALIGN_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={object.align === option.value ? 'secondary' : 'outline'}
                size='sm'
                aria-label={`${option.label}对齐`}
                aria-pressed={object.align === option.value}
                title={`${option.label}对齐`}
                onClick={() => commitObject(object.id, { align: option.value })}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className='space-y-1.5'>
        <span className='text-muted-foreground text-xs'>层级</span>
        <div className='flex gap-1.5'>
          <Button variant='outline' size='sm' onClick={() => reorder(object.id, 'forward')}>
            <Icons.chevronUp /> 上移
          </Button>
          <Button variant='outline' size='sm' onClick={() => reorder(object.id, 'backward')}>
            <Icons.chevronDown /> 下移
          </Button>
        </div>
      </div>

      {image && <AiEditDialog object={image} open={aiEditOpen} onOpenChange={setAiEditOpen} />}
    </div>
  );
}

/** 多选对齐方式：以选区包围盒为基准，按对象自身包围盒的差值平移（类型无关，圆/文字同样适用） */
type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/** 对齐按钮（label + aria）：数据驱动，避免 6 份重复 JSX */
const ALIGN_OPTIONS: { mode: AlignMode; label: string; aria: string }[] = [
  { mode: 'left', label: '左', aria: '左对齐' },
  { mode: 'centerX', label: '中', aria: '水平居中' },
  { mode: 'right', label: '右', aria: '右对齐' },
  { mode: 'top', label: '顶', aria: '顶对齐' },
  { mode: 'centerY', label: '中', aria: '垂直居中' },
  { mode: 'bottom', label: '底', aria: '底对齐' }
];

function computeAlignPatches(objects: DesignObject[], mode: AlignMode): ObjectPatchEntry[] {
  if (objects.length < 2) return [];
  const bbox = unionBox(objects.map(objectBounds));
  if (!bbox) return [];
  return objects.map((object) => {
    const b = objectBounds(object);
    let patch: ObjectPatch = {};
    switch (mode) {
      case 'left':
        patch = { x: object.x + (bbox.x - b.x) };
        break;
      case 'centerX':
        patch = { x: object.x + (bbox.x + bbox.width / 2 - (b.x + b.width / 2)) };
        break;
      case 'right':
        patch = { x: object.x + (bbox.x + bbox.width - (b.x + b.width)) };
        break;
      case 'top':
        patch = { y: object.y + (bbox.y - b.y) };
        break;
      case 'centerY':
        patch = { y: object.y + (bbox.y + bbox.height / 2 - (b.y + b.height / 2)) };
        break;
      case 'bottom':
        patch = { y: object.y + (bbox.y + bbox.height - (b.y + b.height)) };
        break;
    }
    return { id: object.id, patch };
  });
}

/** 多选属性：批量删除 / 对齐 / 图层前后（隐藏单对象样式编辑） */
function MultiProperties() {
  const { selectedIds, selectedObjects, commitObjects, removeObjects, reorderMany } = useEditor();
  const align = (mode: AlignMode) => {
    const patches = computeAlignPatches(selectedObjects, mode);
    if (patches.length > 0) commitObjects(patches);
  };

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>已选 {selectedObjects.length} 个对象</span>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='删除选中对象'
          onClick={() => removeObjects(selectedIds)}
          className='text-destructive hover:text-destructive'
        >
          <Icons.trash />
        </Button>
      </div>

      <div className='space-y-1.5'>
        <span className='text-muted-foreground text-xs'>对齐</span>
        <div className='grid grid-cols-3 gap-1.5'>
          {ALIGN_OPTIONS.map((option) => (
            <Button
              key={option.mode}
              variant='outline'
              size='sm'
              aria-label={option.aria}
              title={option.aria}
              onClick={() => align(option.mode)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className='space-y-1.5'>
        <span className='text-muted-foreground text-xs'>层级</span>
        <div className='flex gap-1.5'>
          <Button variant='outline' size='sm' onClick={() => reorderMany(selectedIds, 'forward')}>
            <Icons.chevronUp /> 上移
          </Button>
          <Button variant='outline' size='sm' onClick={() => reorderMany(selectedIds, 'backward')}>
            <Icons.chevronDown /> 下移
          </Button>
        </div>
      </div>
    </div>
  );
}

function CanvasProperties() {
  const { document, updateDocument, fitToScreen } = useEditor();

  const applyPreset = (width: number, height: number) => {
    updateDocument({ width, height });
    // 等状态提交后再按新尺寸自适应视图
    requestAnimationFrame(() => fitToScreen());
  };

  return (
    <div className='space-y-4'>
      <span className='text-sm font-medium'>画布</span>

      <div className='space-y-1.5'>
        <span className='text-muted-foreground text-xs'>背景色</span>
        <Swatches
          value={document.background}
          onPick={(color) => updateDocument({ background: color })}
          label='背景色'
        />
      </div>

      <div className='space-y-1.5'>
        <span className='text-muted-foreground text-xs'>尺寸预设</span>
        <div className='flex flex-col gap-1.5'>
          {CANVAS_PRESETS.map((preset) => {
            const active = document.width === preset.width && document.height === preset.height;
            return (
              <Button
                key={preset.label}
                variant={active ? 'secondary' : 'outline'}
                size='sm'
                className='justify-between'
                onClick={() => applyPreset(preset.width, preset.height)}
              >
                <span>{preset.label}</span>
                <span className='text-muted-foreground text-xs'>
                  {preset.width}×{preset.height}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LayersList() {
  const { objects, selectedIds, select, toggleSelect } = useEditor();
  const selectedSet = new Set(selectedIds);
  // 逆序：数组末尾为最上层，列表顶部显示最上层
  const layered = objects.toReversed();

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='text-muted-foreground px-3 py-2 text-xs'>图层（{objects.length}）</div>
      {layered.length === 0 ? (
        <p className='text-muted-foreground px-3 pb-3 text-xs'>
          画布为空。用上方工具添加矩形、圆形、文字或图片。
        </p>
      ) : (
        <ul className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
          {layered.map((object) => {
            const meta = OBJECT_TYPE_META[object.type];
            const active = selectedSet.has(object.id);
            const name =
              object.type === 'text'
                ? object.text.split('\n')[0].slice(0, 18) || '文字'
                : meta.label;
            return (
              <li key={object.id}>
                <button
                  type='button'
                  onClick={(event) =>
                    event.shiftKey ? toggleSelect(object.id) : select([object.id])
                  }
                  aria-current={active}
                  className={cn(
                    'hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    active && 'bg-muted font-medium'
                  )}
                >
                  <meta.icon className='text-muted-foreground size-4 shrink-0' />
                  <span className='truncate'>{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function PropertiesPanel() {
  const { selectedObjects } = useEditor();
  let body: React.ReactNode;
  if (selectedObjects.length > 1) {
    body = <MultiProperties />;
  } else if (selectedObjects.length === 1) {
    // key=对象 id：切换选中时重建面板，重置「AI 修改」等局部弹层状态
    body = <ObjectProperties key={selectedObjects[0].id} object={selectedObjects[0]} />;
  } else {
    body = <CanvasProperties />;
  }
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='shrink-0 p-3'>{body}</div>
      <Separator />
      <LayersList />
    </div>
  );
}
