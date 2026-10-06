import type { AlibabaEmbeddingModelOptions } from '@ai-sdk/alibaba';
import { embed, embedMany } from 'ai';
import { resolveEmbeddingModel } from '@/features/agent/api/provider';
import { EMBED_BATCH_SIZE, EMBEDDING_DIM } from '@/features/agent/constants/embedding';

/**
 * 向量化封装（server-only）：检索用单条 embed、摄取用分批 embedMany。
 *
 * 百炼 text-embedding-v4 走 @ai-sdk/alibaba 原生 embedding 端点，provider 的
 * maxEmbeddingsPerCall 为 10（单次超过即抛错），故这里显式按 EMBED_BATCH_SIZE 分批，
 * 并以 EMBED_MAX_CONCURRENCY 限制并发，避免触发服务端 QPS 限流。
 */

/** 同时进行的批次数（个人规模下 3 路并发足够，且不易触发限流） */
const EMBED_MAX_CONCURRENCY = 3;

/**
 * providerOptions key 为 `alibaba`（provider 规范名）；维度字段是单数 `dimension`。
 * 注：text_type（query/document）经实测对 text-embedding-v4 不改变向量（v4 的非对称增强
 * 靠 instruct，而 @ai-sdk/alibaba 未暴露该参数），故此处不设置。
 */
const embeddingProviderOptions = {
  alibaba: { dimension: EMBEDDING_DIM } satisfies AlibabaEmbeddingModelOptions
};

/** 维度自检：provider 未按 dimension 返回时立即失败，避免写入与列维度不一致的向量 */
function assertDim(embedding: number[]): number[] {
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding 维度不匹配：期望 ${EMBEDDING_DIM}，实际 ${embedding.length}（检查 EMBEDDING_MODEL 与 dimension 配置）`
    );
  }
  return embedding;
}

/** 单条向量化：语义检索的 query 用 */
export async function embedQuery(value: string): Promise<number[]> {
  const { embedding } = await embed({
    model: resolveEmbeddingModel(),
    value,
    providerOptions: embeddingProviderOptions
  });
  return assertDim(embedding);
}

/**
 * 批量向量化：摄取管线用，返回顺序与入参一致 + 累计 tokens（供 Credits 计费）。
 * 分批 + 有限并发（逐组 await），单批失败即整体失败（由调用方置文档 failed）。
 */
export async function embedTexts(
  values: string[]
): Promise<{ embeddings: number[][]; tokens: number }> {
  if (values.length === 0) return { embeddings: [], tokens: 0 };
  const model = resolveEmbeddingModel();
  const batches: string[][] = [];
  for (let start = 0; start < values.length; start += EMBED_BATCH_SIZE) {
    batches.push(values.slice(start, start + EMBED_BATCH_SIZE));
  }

  const embeddings: number[][] = [];
  let tokens = 0;
  for (let start = 0; start < batches.length; start += EMBED_MAX_CONCURRENCY) {
    const group = batches.slice(start, start + EMBED_MAX_CONCURRENCY);
    const results = await Promise.all(
      group.map((batch) =>
        embedMany({ model, values: batch, providerOptions: embeddingProviderOptions })
      )
    );
    for (const result of results) {
      embeddings.push(...result.embeddings.map(assertDim));
      // 累计 embedding tokens（供摄取成功后按 priceEmbedding 计费）
      tokens += result.usage?.tokens ?? 0;
    }
  }
  return { embeddings, tokens };
}
