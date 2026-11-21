'use client';

import { Icons } from '@/components/icons';
import { Trace, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import type { AgentToolPart } from '../../api/types';
import { ToolStep } from './tool-step';

type LoadSkillToolPart = AgentToolPart<'loadSkill'>;

/**
 * loadSkill 工具渲染：加载中 → 步骤行；完成 → 「已加载技能：X」；
 * 失败 → 错误步骤行。技能正文不在此展示（进入模型上下文，不打扰用户）。
 */
export function ToolSkillPart({ part, active }: { part: LoadSkillToolPart; active: boolean }) {
  const state = part.state;
  const name = part.output?.name ?? part.input?.name;

  if (state === 'input-streaming' || state === 'input-available') {
    if (!active) {
      return <ToolStep state='stopped' title='已停止：技能加载未完成' />;
    }
    return <ToolStep state='running' title={`正在加载技能${name ? `：${name}` : '…'}`} />;
  }

  if (state === 'output-available') {
    return (
      <Trace>
        <TraceLine>
          <TraceIcon>
            <Icons.sparkles />
          </TraceIcon>
          <TraceTitle>{name ? `已加载技能：${name}` : '已加载技能'}</TraceTitle>
        </TraceLine>
      </Trace>
    );
  }

  if (state === 'output-error') {
    return <ToolStep state='error' title='技能加载失败' errorText={part.errorText ?? '未知错误'} />;
  }

  return null;
}
