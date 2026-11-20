'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';
import { Icons } from '@/components/icons';
import { getModelLabel, MODEL_KEYS, MODEL_REGISTRY } from '../../constants/models';

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 模型选择器：ghost 触发器（参考 AI Elements model-selector），切换后立即生效（会话级持久化） */
export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label='选择对话模型'
        title={getModelLabel(value)}
        render={
          <InputGroupButton
            size='sm'
            className='max-w-28 text-xs font-medium text-muted-foreground hover:text-foreground sm:max-w-56'
          />
        }
      >
        <span className='min-w-0 truncate'>{getModelLabel(value)}</span>
        <Icons.chevronDown className='size-3 shrink-0 opacity-60' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side='top' className='w-56'>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (typeof next === 'string') onChange(next);
          }}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>对话模型</DropdownMenuLabel>
            {MODEL_KEYS.map((key) => (
              <DropdownMenuRadioItem key={key} value={key} closeOnClick>
                {MODEL_REGISTRY[key].label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
