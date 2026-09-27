import PageContainer from '@/components/layout/page-container';
import { AddDocumentButton } from '@/features/knowledge/components/add-document-button';
import KnowledgeListing from '@/features/knowledge/components/knowledge-listing';
import { KnowledgeSearchPanel } from '@/features/knowledge/components/knowledge-search-panel';
import { searchParamsCache } from '@/lib/searchparams';
import type { SearchParams } from 'nuqs/server';

export const metadata = {
  title: 'Dashboard: 知识库'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function KnowledgePage(props: PageProps) {
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      pageTitle='知识库'
      pageDescription='沉淀你的资料，Agent 会按语义检索后作答并标注来源。'
      pageHeaderAction={
        <div className='flex items-center gap-2'>
          <KnowledgeSearchPanel />
          <AddDocumentButton />
        </div>
      }
    >
      <KnowledgeListing />
    </PageContainer>
  );
}
