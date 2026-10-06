import { customType } from 'drizzle-orm/pg-core';

/**
 * pgvector 列支撑（drizzle-orm 无原生 vector 类型，用 customType 声明）。
 *
 * 前置：目标库需已启用扩展（`CREATE EXTENSION IF NOT EXISTS vector;`）。
 * 维度一旦变更，向量列与 HNSW 索引都必须重建（历史数据需重新 embedding）。
 */

/** 向量维度：必须与 embedding 的 dimension 参数（providerOptions.alibaba.dimension）完全一致 */
export const VECTOR_DIM = 1024;

/** number[] → pgvector 文本字面量（写入与 `<=>` 检索参数共用同一序列化） */
export function toVectorLiteral(value: number[]): string {
  return `[${value.join(',')}]`;
}

/** pgvector 文本字面量 → number[]（驱动对未知 OID 返回文本，`[1,2]` 即合法 JSON） */
function fromVectorLiteral(value: string): number[] {
  return JSON.parse(value) as number[];
}

export const vector1024 = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${VECTOR_DIM})`,
  toDriver: toVectorLiteral,
  fromDriver: fromVectorLiteral
});
