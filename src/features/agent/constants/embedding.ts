import { VECTOR_DIM } from '@/lib/db/vector';

/**
 * Embedding（向量化）配置 —— RAG 知识库与语义检索共用。
 *
 * 以百炼官方文档为准（text-embedding-v4，Qwen3-Embedding 系列）：
 * - 维度可选 2048/1536/1024(默认)/768/512/256/128/64，经 providerOptions.alibaba.dimension 指定
 * - provider maxEmbeddingsPerCall 为 **10**（单次超过即抛错），单行最长 8192 token
 *
 * 维度必须与向量列维度（`src/lib/db/vector.ts` 的 VECTOR_DIM）一致：
 * 改维度需重建向量列与 HNSW 索引，并对全部历史数据重新 embedding。
 */

export const EMBEDDING_MODEL = 'text-embedding-v4';

/** 向量维度（= knowledge_chunks.embedding 列维度） */
export const EMBEDDING_DIM = VECTOR_DIM;

/** 单次 embedding 调用的最大条数（百炼 text-embedding-v4 官方上限 10） */
export const EMBED_BATCH_SIZE = 10;
