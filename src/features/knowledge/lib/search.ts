import { searchKnowledge } from '../api/service';
import { DEFAULT_SEARCH_TOP_K, MAX_SEARCH_TOP_K, SEARCH_MIN_SCORE } from '../constants/knowledge';
import { embedQuery } from './embeddings';

/**
 * 语义检索入口（server-only）：文本 query → embedding → pgvector cosine topK。
 *
 * 低相关片段按 SEARCH_MIN_SCORE 过滤：实测明显无关的查询在真实语料上也会拿到
 * 0.24~0.36 的噪声分，不过滤会把噪声塞进模型上下文（Agent 反而容易"强行引用"）。
 * 阈值经真实语料标定（见 constants/knowledge.ts），宁可漏召也不误导；调参只改常量。
 */
export async function searchKnowledgeByText(
  userId: string,
  query: string,
  topK: number = DEFAULT_SEARCH_TOP_K
) {
  const limit = Math.min(MAX_SEARCH_TOP_K, Math.max(1, Math.floor(topK)));
  const queryVector = await embedQuery(query);
  const hits = await searchKnowledge(userId, queryVector, limit);
  return hits.filter((hit) => hit.score >= SEARCH_MIN_SCORE);
}
