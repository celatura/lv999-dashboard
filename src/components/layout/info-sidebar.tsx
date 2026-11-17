'use client';

import * as React from 'react';
import { Icons } from '@/components/icons';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Infobar,
  InfobarContent,
  InfobarGroup,
  InfobarGroupContent,
  InfobarHeader,
  InfobarRail,
  InfobarTrigger,
  useInfobar
} from '@/components/ui/infobar';

// Default/fallback data when no content is set
const defaultData = {
  title: '文档',
  sections: [
    {
      title: '快速开始',
      description: '了解如何开始使用本应用。',
      links: [
        {
          title: '安装指南',
          url: '#'
        }
      ]
    }
  ]
};

export function InfoSidebar({ className, ...props }: React.ComponentProps<typeof Infobar>) {
  const { content } = useInfobar();
  const data = content || defaultData;

  return (
    // 外壳是固定高度列，面板直接撑满它（不再按视口高度计算）
    <Infobar {...props} className={cn('h-full rounded-none border-t-0', className)}>
      <InfobarHeader className='bg-sidebar sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold wrap-break-word'>{data.title}</h2>
        </div>
        <div className='shrink-0'>
          <InfobarTrigger />
        </div>
      </InfobarHeader>
      <InfobarContent>
        <InfobarGroup>
          <InfobarGroupContent>
            <div className='flex flex-col gap-6 px-4 py-4'>
              {data.sections && data.sections.length > 0 ? (
                data.sections.map((section) => (
                  <div key={section.title} className='flex flex-col gap-3'>
                    {section.title && (
                      <h3 className='text-foreground text-sm font-semibold'>{section.title}</h3>
                    )}
                    {section.description && (
                      <p className='text-muted-foreground text-sm leading-relaxed'>
                        {section.description}
                      </p>
                    )}
                    {section.links && section.links.length > 0 && (
                      <div className='flex flex-col gap-2'>
                        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                          了解更多
                        </h4>
                        <ul className='flex flex-col gap-1.5'>
                          {section.links.map((link) => (
                            <li key={link.title}>
                              <Link
                                href={link.url}
                                className='text-primary flex items-center gap-1.5 text-sm underline'
                                target='_blank'
                                rel='noopener noreferrer'
                              >
                                <span>{link.title}</span>
                                <Icons.chevronRight className='h-3 w-3' />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className='text-muted-foreground px-2 py-4 text-center text-sm'>暂无内容</div>
              )}
            </div>
          </InfobarGroupContent>
        </InfobarGroup>
      </InfobarContent>
      <InfobarRail />
    </Infobar>
  );
}
