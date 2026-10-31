'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getModelLabel, MODEL_KEYS, MODEL_REGISTRY } from '../../constants/models';

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** 模型选择器：默认 deepseek-flash，切换后立即生效（会话级持久化） */
export function ModelSelector({ value, onChange, disabled }: ModelSelectorProps) {
  const items = MODEL_KEYS.map((key) => ({
    value: key,
    label: MODEL_REGISTRY[key].label
  }));

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size='sm'
        className='max-w-28 sm:max-w-56'
        aria-label='选择对话模型'
        title={getModelLabel(value)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            {MODEL_REGISTRY[key].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
