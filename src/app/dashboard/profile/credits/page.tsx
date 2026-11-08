import PageContainer from '@/components/layout/page-container';
import CreditsListing from '@/features/credits/components/credits-listing';
import { searchParamsCache } from '@/lib/searchparams';
import type { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: Credits 明细'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

/**
 * Credits 流水页。
 * 具体路由段 profile/credits 优先于 profile/[[...profile]] catch-all，
 * 故 /dashboard/profile/credits 命中本页而非个人资料页。
 */
export default async function CreditsPage(props: PageProps) {
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='Credits 明细'
      pageDescription='查看 Credits 余额与每笔变动流水（对话 / 图片 / 视频 / 知识库 / 发放）。'
    >
      <CreditsListing />
    </PageContainer>
  );
}
