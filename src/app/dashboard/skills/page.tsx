import PageContainer from '@/components/layout/page-container';
import { CreateSkillButton } from '@/features/agent/components/skills/create-skill-button';
import SkillsListing from '@/features/agent/components/skills/skills-listing';

export const metadata = {
  title: 'Dashboard: 技能'
};

export default function SkillsPage() {
  return (
    <PageContainer
      pageTitle='技能'
      pageDescription='把你的创作套路沉淀为专属专家：人设指令 + 工具范围 + 示例，在对话中与内置技能混用。'
      pageHeaderAction={<CreateSkillButton />}
    >
      <SkillsListing />
    </PageContainer>
  );
}
