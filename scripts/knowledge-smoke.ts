/* oxlint-disable no-console */
/**
 * RAG 知识库链路冒烟：切分 → embed → 存 pgvector → cosine 检索命中 → 删除级联。
 *
 * 运行：bun run scripts/knowledge-smoke.ts
 * 前置：.env.local 中 DATABASE_URL 与 DASHSCOPE_API_KEY；目标库已启用 vector 扩展。
 *
 * 覆盖两条链路：
 * 1. 短文档（单片段）：摄取 → 相关问句命中 / 无关问句低分 → 删除后不再命中；
 * 2. 长文档（多片段，超过百炼单批 10 条上限）：验证分批 embedding 与定位到具体片段。
 *
 * 说明：脚本使用独立的 smoke 用户 id 并在结尾删除文档，不污染真实数据。
 */
import {
  createDocument,
  deleteDocument,
  listDocuments,
  searchKnowledge
} from '../src/features/knowledge/api/service';
import {
  ingestChunks,
  prepareChunks,
  reserveKnowledgeCredits
} from '../src/features/knowledge/lib/ingest';
import { grantCredits } from '../src/features/credits/api/service';
import { getDb } from '../src/lib/db';
import { creditLedger, creditsAccounts } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { embedQuery } from '../src/features/knowledge/lib/embeddings';
import { EMBED_BATCH_SIZE } from '../src/features/agent/constants/embedding';

const SMOKE_USER = `knowledge-smoke-${Date.now()}`;

const shortText = [
  '# 可恢复流实现笔记',
  'resumable-stream 用 Redis Stream 保存生产中的输出：客户端断开后生产者继续把流写完（waitUntil 保活），',
  '重新订阅时通过 XREAD BLOCK 从上次位置继续读取，因此刷新页面不会丢失正在生成的内容。',
  '停止生成走另一条 Redis 键：stop 端点写入停止标志，服务端轮询命中后 abort 底层生成请求。'
].join('\n');

/** 构造长文档：每节一个主题 + 一个唯一事实标识，用于验证分批与片段定位 */
function buildLongText(sections: number): string {
  const topics = [
    '连接池管理',
    '超时与重试',
    '幂等写入',
    '流式响应',
    '缓存失效',
    '限流窗口',
    '向量索引',
    '事务边界',
    '错误信封',
    '签名直传'
  ];
  const filler =
    '在生产环境中需要关注连接复用、超时预算与退避重试策略，并通过结构化日志与指标持续观测其行为变化。';
  const parts: string[] = ['# 工程实践手册'];
  for (let index = 1; index <= sections; index += 1) {
    const topic = topics[index % topics.length];
    parts.push(
      [
        `## 第 ${index} 节 · ${topic}`,
        `${filler.repeat(4)}`,
        `唯一事实 FACT-${index}：${topic} 的编号是 ${index}，对应章节为第 ${index} 节。`
      ].join('\n')
    );
  }
  return parts.join('\n\n');
}

async function ingest(userId: string, title: string, content: string) {
  const chunks = prepareChunks(content);
  const reservation = await reserveKnowledgeCredits(userId, chunks);
  if (!reservation) throw new Error('Insufficient smoke test credits');
  const doc = await createDocument({ userId, title, source: 'manual', content });
  const result = await ingestChunks({
    userId,
    documentId: doc.id,
    chunks,
    reservationId: reservation.id
  });
  return { doc, chunks, result };
}

const checks: string[] = [];
function check(name: string, ok: boolean) {
  checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

// --- 1. 短文档：单片段 + 相关/无关对照 + 删除级联 -------------------------
await grantCredits({ userId: SMOKE_USER, amount: 1000, note: 'knowledge smoke' });
const short = await ingest(SMOKE_USER, '冒烟：可恢复流笔记', shortText);
console.log('short chunks:', short.chunks.length, 'ingest:', short.result);
check('短文档摄取成功', short.result.status === 'ready' && short.result.chunkCount > 0);

const relatedVector = await embedQuery('刷新页面后正在生成的内容会丢吗？');
console.log('query embedding dim:', relatedVector.length);
check('向量维度为 1024', relatedVector.length === 1024);

const relatedHits = await searchKnowledge(SMOKE_USER, relatedVector, 3);
const offVector = await embedQuery('今天杭州的天气怎么样');
const offHits = await searchKnowledge(SMOKE_USER, offVector, 3);
console.log(
  'related best:',
  relatedHits[0]?.score,
  'off-topic best:',
  offHits[0]?.score,
  'preview:',
  relatedHits[0]?.content.slice(0, 30)
);
check('相关问句命中', relatedHits.length > 0 && relatedHits[0].score > 0.4);
check('无关问句得分显著更低', (offHits[0]?.score ?? 0) < (relatedHits[0]?.score ?? 0));

// --- 2. 长文档：多片段（超过单批上限）+ 定位到具体片段 ---------------------
const longText = buildLongText(30);
const long = await ingest(SMOKE_USER, '冒烟：工程实践手册', longText);
console.log(
  'long text bytes:',
  Buffer.byteLength(longText, 'utf8'),
  'chunks:',
  long.chunks.length,
  'batches:',
  Math.ceil(long.chunks.length / EMBED_BATCH_SIZE),
  'ingest:',
  long.result
);
check('长文档切分为多片段', long.chunks.length > EMBED_BATCH_SIZE);
check(
  '长文档分批摄取成功',
  long.result.status === 'ready' && long.result.chunkCount === long.chunks.length
);

const factVector = await embedQuery('FACT-25 是哪个编号、对应第几节？');
const factHits = await searchKnowledge(SMOKE_USER, factVector, 5);
console.log(
  'fact hits:',
  factHits.map((hit) => ({ chunkIndex: hit.chunkIndex, score: hit.score }))
);
check(
  '定位到含 FACT-25 的片段',
  factHits.some((hit) => hit.content.includes('FACT-25')) &&
    factHits.every((hit) => hit.documentId === long.doc.id)
);

const listed = await listDocuments(SMOKE_USER, { page: 1, limit: 10, status: 'ready' });
console.log(
  'list total:',
  listed.total,
  'titles:',
  listed.documents.map((d) => d.title)
);
check('列表按状态筛选返回两篇', listed.total === 2);

// --- 3. 清理：删除文档 → 片段级联删除 → 不再被检索到 ----------------------
const deletedShort = await deleteDocument(SMOKE_USER, short.doc.id);
const deletedLong = await deleteDocument(SMOKE_USER, long.doc.id);
const afterDelete = await searchKnowledge(SMOKE_USER, relatedVector, 5);
check('删除成功且片段级联清理', deletedShort && deletedLong && afterDelete.length === 0);
await getDb().delete(creditLedger).where(eq(creditLedger.userId, SMOKE_USER));
await getDb().delete(creditsAccounts).where(eq(creditsAccounts.userId, SMOKE_USER));

const failed = checks.filter((line) => line.startsWith('FAIL'));
console.log(failed.length === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failed.length} 项未通过`);
process.exit(failed.length === 0 ? 0 : 1);
