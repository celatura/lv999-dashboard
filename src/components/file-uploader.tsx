'use client';

import { Icons, type Icon } from '@/components/icons';
import Image from 'next/image';
import * as React from 'react';
import Dropzone, { type DropzoneProps, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useControllableState } from '@/hooks/use-controllable-state';
import { cn, formatBytes } from '@/lib/utils';

export interface FileUploaderProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Value of the uploader.
   * @type File[]
   * @default undefined
   * @example value={files}
   */
  value?: File[];

  /**
   * Function to be called when the value changes.
   * @type React.Dispatch<React.SetStateAction<File[]>>
   * @default undefined
   * @example onValueChange={(files) => setFiles(files)}
   */
  onValueChange?: React.Dispatch<React.SetStateAction<File[]>>;

  /**
   * Function to be called when files are uploaded.
   * @type (files: File[]) => Promise<void>
   * @default undefined
   * @example onUpload={(files) => uploadFiles(files)}
   */
  onUpload?: (files: File[]) => Promise<void>;

  /**
   * Progress of the uploaded files.
   * @type Record<string, number> | undefined
   * @default undefined
   * @example progresses={{ "file1.png": 50 }}
   */
  progresses?: Record<string, number>;

  /**
   * Accepted file types for the uploader.
   * @type { [key: string]: string[]}
   * @default
   * ```ts
   * { "image/*": [] }
   * ```
   * @example accept={["image/png", "image/jpeg"]}
   */
  accept?: DropzoneProps['accept'];

  /**
   * Maximum file size for the uploader.
   * @type number | undefined
   * @default 1024 * 1024 * 2 // 2MB
   * @example maxSize={1024 * 1024 * 2} // 2MB
   */
  maxSize?: DropzoneProps['maxSize'];

  /**
   * Maximum number of files for the uploader.
   * @type number | undefined
   * @default 1
   * @example maxFiles={5}
   */
  maxFiles?: DropzoneProps['maxFiles'];

  /**
   * Whether the uploader should accept multiple files.
   * @type boolean
   * @default false
   * @example multiple
   */
  multiple?: boolean;

  /**
   * Whether the uploader is disabled.
   * @type boolean
   * @default false
   * @example disabled
   */
  disabled?: boolean;
}

export function FileUploader(props: FileUploaderProps) {
  const {
    value: valueProp,
    onValueChange,
    onUpload,
    progresses,
    accept = { 'image/*': [] },
    maxSize = 1024 * 1024 * 2,
    maxFiles = 1,
    multiple = false,
    disabled = false,
    className,
    ...dropzoneProps
  } = props;

  const [files, setFiles] = useControllableState({
    prop: valueProp,
    onChange: onValueChange
  });

  const onDrop = React.useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (!multiple && maxFiles === 1 && acceptedFiles.length > 1) {
        toast.error('一次只能上传 1 个文件');
        return;
      }

      if ((files?.length ?? 0) + acceptedFiles.length > maxFiles) {
        toast.error(`最多上传 ${maxFiles} 个文件`);
        return;
      }

      // 仅图片创建 object-URL 预览；PDF/office 等非图片的 blob 无法被 <Image> 渲染（会破图），
      // 这类文件在 FileCard 中改用文件类型图标展示
      const newFiles = acceptedFiles.map((file) =>
        file.type.startsWith('image/')
          ? Object.assign(file, { preview: URL.createObjectURL(file) })
          : file
      );

      const updatedFiles = files ? [...files, ...newFiles] : newFiles;

      setFiles(updatedFiles);

      if (rejectedFiles.length > 0) {
        rejectedFiles.forEach(({ file }) => {
          toast.error(`文件 ${file.name} 不符合要求（类型或大小）`);
        });
      }

      if (onUpload && updatedFiles.length > 0 && updatedFiles.length <= maxFiles) {
        toast.promise(onUpload(updatedFiles), {
          loading: '正在上传…',
          success: () => {
            setFiles([]);
            return '上传完成';
          },
          // 优先展示调用方抛出的具体错误消息（如「图片超过 10MB 上限」），无则回退通用文案
          error: (error) => (error instanceof Error && error.message ? error.message : '上传失败')
        });
      }
    },

    [files, maxFiles, multiple, onUpload, setFiles]
  );

  function onRemove(index: number) {
    if (!files) return;
    const newFiles = files.filter((_, i) => i !== index);
    setFiles(newFiles);
    onValueChange?.(newFiles);
  }

  // Revoke preview url when component unmounts
  React.useEffect(() => {
    return () => {
      if (!files) return;
      files.forEach((file) => {
        if (isFileWithPreview(file)) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDisabled = disabled || (files?.length ?? 0) >= maxFiles;

  return (
    <div className='relative flex flex-col gap-6 overflow-hidden'>
      <Dropzone
        onDrop={onDrop}
        accept={accept}
        maxSize={maxSize}
        maxFiles={maxFiles}
        multiple={maxFiles > 1 || multiple}
        disabled={isDisabled}
      >
        {({ getRootProps, getInputProps, isDragActive }) => (
          <div
            {...getRootProps()}
            className={cn(
              'group border-muted-foreground/25 hover:bg-muted/25 relative grid h-52 w-full cursor-pointer place-items-center rounded-lg border-2 border-dashed px-5 py-2.5 text-center transition',
              'ring-offset-background focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
              isDragActive && 'border-muted-foreground/50',
              isDisabled && 'pointer-events-none opacity-60',
              className
            )}
            {...dropzoneProps}
          >
            <input {...getInputProps()} aria-label='上传文件' />
            {isDragActive ? (
              <div className='flex flex-col items-center justify-center gap-4 sm:px-5'>
                <div className='rounded-full border border-dashed p-3'>
                  <Icons.upload className='text-muted-foreground size-7' aria-hidden='true' />
                </div>
                <p className='text-muted-foreground font-medium'>拖拽文件到此处</p>
              </div>
            ) : (
              <div className='flex flex-col items-center justify-center gap-4 sm:px-5'>
                <div className='rounded-full border border-dashed p-3'>
                  <Icons.upload className='text-muted-foreground size-7' aria-hidden='true' />
                </div>
                <div className='space-y-px'>
                  <p className='text-muted-foreground font-medium'>
                    拖拽文件到此处，或点击选择文件
                  </p>
                  <p className='text-muted-foreground/70 text-sm'>
                    {maxFiles > 1
                      ? `可上传 ${maxFiles === Infinity ? '多个' : maxFiles} 个文件（每个不超过 ${formatBytes(maxSize)}）`
                      : `可上传 1 个文件（不超过 ${formatBytes(maxSize)}）`}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </Dropzone>
      {files?.length ? (
        <ScrollArea className='h-fit w-full px-3'>
          <div className='max-h-48 space-y-4'>
            {files?.map((file, index) => (
              <FileCard
                key={index}
                file={file}
                onRemove={() => onRemove(index)}
                progress={progresses?.[file.name]}
              />
            ))}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
}

interface FileCardProps {
  file: File;
  onRemove: () => void;
  progress?: number;
}

function FileCard({ file, progress, onRemove }: FileCardProps) {
  const FileIcon = fileIconFor(file.name);
  return (
    <div className='relative flex items-center space-x-4'>
      <div className='flex flex-1 space-x-4'>
        {isFileWithPreview(file) ? (
          <Image
            src={file.preview}
            alt={file.name}
            width={48}
            height={48}
            loading='lazy'
            className='aspect-square shrink-0 rounded-md object-cover'
          />
        ) : (
          <span className='bg-muted flex size-12 shrink-0 items-center justify-center rounded-md'>
            {/* oxlint-disable-next-line react/static-components -- fileIconFor 只从 Icons 注册表取已有组件引用，并非渲染期新建组件 */}
            <FileIcon className='text-muted-foreground size-5' />
          </span>
        )}
        <div className='flex w-full flex-col gap-2'>
          <div className='space-y-px'>
            <p className='text-foreground/80 line-clamp-1 text-sm font-medium'>{file.name}</p>
            <p className='text-muted-foreground text-xs'>{formatBytes(file.size)}</p>
          </div>
          {progress ? <Progress value={progress} /> : null}
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          onClick={onRemove}
          disabled={progress !== undefined && progress < 100}
          className='size-8 rounded-full'
        >
          <Icons.close className='text-muted-foreground' />
          <span className='sr-only'>移除文件</span>
        </Button>
      </div>
    </div>
  );
}

function isFileWithPreview(file: File): file is File & { preview: string } {
  return 'preview' in file && typeof file.preview === 'string';
}

/** 非图片文件按扩展名选图标（复用 icons 注册表）；文本类等其余用文档图标兜底 */
function fileIconFor(filename: string): Icon {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return Icons.fileTypePdf;
  if (ext === 'doc' || ext === 'docx' || ext === 'docm') return Icons.fileTypeDoc;
  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm' || ext === 'csv') return Icons.fileTypeXls;
  if (ext === 'zip') return Icons.fileZip;
  return Icons.post;
}
