'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertModal } from '@/components/modal/alert-modal';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingButton } from '@/components/ui/loading-button';
import { Icons } from '@/components/icons';
import { ApiError, apiClient } from '@/lib/api-client';

interface AvatarCardProps {
  /** 用户名字（无头像时回退首字母占位） */
  name: string;
  /** 当前 user.image（同源代理路径，或 null） */
  image: string | null;
}

/** 与服务端一致：png / jpeg / webp，≤5MB（服务端为权威校验，此处仅作即时反馈） */
const ACCEPT = 'image/png,image/jpeg,image/webp';
const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/** 服务端错误码 → 中文提示（信封约定：服务端英文 message + code，中文文案由客户端决定） */
function toChineseMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'payload_too_large':
        return '图片不能超过 5MB';
      case 'invalid_request':
        return '请选择有效的图片（png / jpeg / webp）';
      case 'too_many_requests':
        return '操作太频繁，请稍后再试';
      case 'unauthorized':
        return '登录已失效，请重新登录';
    }
  }
  return fallback;
}

/**
 * 头像卡片：预览 + 上传 / 更换 + 删除（确认）。
 *
 * 上传 / 删除成功后乐观更新本地 src（`?v=` 破浏览器缓存）+ `router.refresh()`（同步服务端渲染处，
 * 如侧边栏）；写路径经 Better Auth updateUser 重签 cookie，故 refresh 后各处即时为新头像 / 首字母。
 */
export function AvatarCard({ name, image }: AvatarCardProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // 本地 src 为权威展示源：初始取服务端 image，上传 / 删除后乐观覆盖（含 ?v= 破缓存）
  const [src, setSrc] = useState(image ?? '');
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasAvatar = Boolean(src);
  const busy = uploading || removing;

  async function handleUpload(file: File) {
    if (!ACCEPTED_MIMES.includes(file.type)) {
      toast.error('请选择 png / jpeg / webp 图片');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('图片不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiClient<{ image: string }>('/user/avatar', {
        method: 'POST',
        body: form
      });
      // 覆盖同一代理路径，故加 ?v= 破缓存；侧边栏经 router.refresh() 同步
      setSrc(`${data.image}?v=${Date.now()}`);
      toast.success('头像已更新');
      router.refresh();
    } catch (error) {
      toast.error(toChineseMessage(error, '上传头像失败，请重试'));
    } finally {
      setUploading(false);
      // 清空 value，允许再次选择同一文件时仍触发 onChange
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await apiClient<{ image: null }>('/user/avatar', { method: 'DELETE' });
      setSrc(''); // 乐观回退首字母；侧边栏经 router.refresh() 同步
      toast.success('头像已删除');
      router.refresh();
    } catch (error) {
      toast.error(toChineseMessage(error, '删除头像失败，请重试'));
    } finally {
      setRemoving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>头像</CardTitle>
        <CardDescription>
          支持 png / jpeg / webp，不超过 5MB；上传后自动裁切为正方形。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='flex flex-wrap items-center gap-5'>
          <Avatar className='size-20'>
            <AvatarImage src={src} alt={name} />
            <AvatarFallback className='text-xl'>
              {name.trim().slice(0, 2).toUpperCase() || 'CN'}
            </AvatarFallback>
          </Avatar>

          <div className='flex flex-wrap items-center gap-2'>
            <input
              ref={inputRef}
              type='file'
              accept={ACCEPT}
              aria-label='选择头像图片'
              className='hidden'
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            <LoadingButton
              loading={uploading}
              disabled={busy}
              loadingLabel='上传中…'
              onClick={() => inputRef.current?.click()}
            >
              <Icons.upload className='size-4' />
              {hasAvatar ? '更换头像' : '上传头像'}
            </LoadingButton>
            {hasAvatar && (
              <Button variant='outline' disabled={busy} onClick={() => setConfirmOpen(true)}>
                <Icons.trash className='size-4' />
                删除
              </Button>
            )}
          </div>
        </div>

        <AlertModal
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => void handleRemove()}
          loading={removing}
          title='删除头像？'
          description='删除后将回退为名字首字母占位。'
          confirmLabel='删除'
        />
      </CardContent>
    </Card>
  );
}
