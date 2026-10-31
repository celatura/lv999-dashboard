import { mutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import { agentKeys } from '@/features/agent/api/queries';
import type { GenerateImageRequest } from '@/features/agent/api/types';
import type { CreateDesignRequest, UpdateDesignRequest, UploadImageResponse } from './types';

/** 失效统一放 onSettled：失败时服务端也可能已部分生效；组件覆盖 onSuccess 也不会丢掉失效。 */

/** 资产域失效：列表 + 详情（保存后刷新「我的资产」缩略/标题与预览） */
function invalidateAssets(): void {
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.assetsRoot() });
  void getQueryClient().invalidateQueries({ queryKey: agentKeys.assetRoot() });
}

export const createDesignMutation = mutationOptions({
  mutationFn: (data: CreateDesignRequest) =>
    apiClient<{ id: string }>('/agent/assets', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
  onSettled: invalidateAssets
});

export const updateDesignMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: UpdateDesignRequest }) =>
    apiClient<{ success: boolean }>(`/agent/assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    }),
  onSettled: invalidateAssets
});

/**
 * 本地图片上传（multipart）：服务端存 OSS + 建 source='upload' 资产，返回 { id, width?, height? }。
 * FormData 不设 Content-Type（apiClient 已适配，浏览器自动带 multipart boundary）；
 * 完成后失效资产域（「我的资产」列表出现新上传图）。
 */
export const uploadImageMutation = mutationOptions({
  mutationFn: ({ file }: { file: File }) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient<UploadImageResponse>('/agent/assets/upload', {
      method: 'POST',
      body: form
    });
  },
  onSettled: invalidateAssets
});

/**
 * 画布内 AI 生图（直连 T2I）：POST /api/agent/assets/generate → { id }。
 * 生成耗时 10-60s（端点 maxDuration=300，不提供 abort）；完成后失效资产域，
 * 「我的资产」即出现新图（source='agent'、content=prompt）。
 *
 * 画布内 AI 改图（I2I）不在此重复定义：直接复用 agent 域的
 * `editImageAssetMutation`（同一端点 `/agent/assets/[id]/edit` 与同一失效逻辑）。
 */
export const aiGenerateImageMutation = mutationOptions({
  mutationFn: (values: GenerateImageRequest) =>
    apiClient<{ id: string }>('/agent/assets/generate', {
      method: 'POST',
      body: JSON.stringify(values)
    }),
  onSettled: invalidateAssets
});
