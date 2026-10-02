import { cn } from '@/lib/utils';
import { InteractiveGridPattern } from './interactive-grid';

/**
 * 认证页共用外壳：左侧品牌区（LV999 + InteractiveGridPattern），右侧承载表单。
 * 服务端组件（无 hooks），仅渲染标记与客户端 InteractiveGridPattern。
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='relative flex min-h-screen flex-col items-center justify-center overflow-hidden md:grid lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <div className='relative hidden h-full flex-col p-10 lg:flex dark:border-r'>
        <div className='absolute inset-0 bg-sidebar' />
        <div className='relative z-20 flex flex-col gap-1'>
          <div className='text-sidebar-foreground flex items-center text-lg font-medium'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
              className='mr-2 h-6 w-6'
            >
              <path d='M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3' />
            </svg>
            LV999
          </div>
          <p className='text-sidebar-foreground/70 text-sm'>AI 原生多模态创作平台</p>
        </div>
        <InteractiveGridPattern
          className={cn(
            'mask-[radial-gradient(400px_circle_at_center,white,transparent)]',
            'inset-x-0 inset-y-[0%] h-full skew-y-12'
          )}
        />
      </div>
      <div className='flex h-full items-center justify-center p-4 lg:p-8'>
        <div className='flex w-full max-w-md flex-col items-center justify-center space-y-6'>
          {children}
        </div>
      </div>
    </div>
  );
}
