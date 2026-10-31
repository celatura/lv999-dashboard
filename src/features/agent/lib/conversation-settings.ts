interface ExpectedConversationSettings {
  expectedModel?: unknown;
  expectedSkillId?: unknown;
}

export function matchesConversationSettings(
  expected: ExpectedConversationSettings,
  actual: { model: string; activeSkillId: string | null }
): boolean {
  return (
    (expected.expectedModel === undefined || expected.expectedModel === actual.model) &&
    (expected.expectedSkillId === undefined || expected.expectedSkillId === actual.activeSkillId)
  );
}
