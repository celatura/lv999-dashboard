interface ExpectedConversationSettings {
  expectedModel?: unknown;
}

/**
 * 会话级设置握手：模型仍随会话持久化，发送前校验客户端显示的模型与服务端一致，
 * 避免「切换模型保存失败但界面已切换」导致用错模型计费。
 * 技能不再属于会话设置（改为每条消息 metadata.skillId），故不参与握手。
 */
export function matchesConversationSettings(
  expected: ExpectedConversationSettings,
  actual: { model: string }
): boolean {
  return expected.expectedModel === undefined || expected.expectedModel === actual.model;
}
