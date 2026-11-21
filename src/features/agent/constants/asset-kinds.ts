/**
 * 资产类型枚举值（单一来源）。
 *
 * 独立于 api/types.ts：工具契约（tool-contracts.ts，客户端安全）与消息类型都要引用它，
 * 放在 constants 可避免 contracts ↔ types 的运行时循环依赖。
 */
export const ASSET_KIND_VALUES = ['markdown', 'html', 'image', 'design', 'video'] as const;

export type AssetKind = (typeof ASSET_KIND_VALUES)[number];
