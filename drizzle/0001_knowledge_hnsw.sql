-- Custom SQL migration file, put your code below! --

-- pgvector HNSW 相似度索引：drizzle-kit 不生成（schema.ts 里只有注释），
-- 放在迁移链上才能让空库完整重放；IF NOT EXISTS 保证对既有库可重复执行。
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx"
	ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
