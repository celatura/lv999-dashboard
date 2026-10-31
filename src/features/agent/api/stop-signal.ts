import { getConnectedRedis } from '@/lib/redis';
import { isUuid } from '@/lib/utils';

/**
 * Agent 生成停止信号（跨实例）。
 *
 * 机制：stop 端点写入 Redis 标志；生成路由在生成期间每 2 秒轮询一次，
 * 命中后 abort 底层生成（真取消），onEnd 按中断路径落库部分内容。
 * 无 Workflows 等持久执行平台时，这是 serverless 多实例下最简单可靠的控制通道。
 */

function stopSignalKey(conversationId: string, streamId: string): string {
  return `agent:stop:${conversationId}:${streamId}`;
}

/** 标志 TTL：即便生产者实例已消失，标志也会自动过期，避免残留 */
const STOP_SIGNAL_TTL_SECONDS = 300;

const STOP_WATCH_INTERVAL_MS = 2000;

/** stop 端点调用：写入停止标志 */
export async function requestAgentStop(
  conversationId: string,
  streamId: string,
  active = false
): Promise<void> {
  const redis = await getConnectedRedis();
  await redis.set(stopSignalKey(conversationId, streamId), '1', { EX: STOP_SIGNAL_TTL_SECONDS });
  if (active && !isUuid(streamId)) {
    await redis.set(`agent:stop:${streamId}`, '1', { EX: STOP_SIGNAL_TTL_SECONDS });
  }
}

export async function consumeAgentStop(conversationId: string, streamId: string): Promise<boolean> {
  const redis = await getConnectedRedis();
  const scopedKey = stopSignalKey(conversationId, streamId);
  const legacyKey = `agent:stop:${streamId}`;
  const [scoped, legacy] = await Promise.all([
    redis.get(scopedKey),
    isUuid(streamId) ? Promise.resolve(null) : redis.get(legacyKey)
  ]);
  const keys = [scoped ? scopedKey : null, legacy ? legacyKey : null].filter(
    (key): key is string => key !== null
  );
  await Promise.all(keys.map((key) => redis.del(key)));
  return Boolean(scoped || legacy);
}

/**
 * 生成路由调用：轮询停止标志，命中后触发 onStop 并清理标志。
 * 返回清理函数（生成结束时调用以停止轮询）。
 */
export function watchAgentStop(
  conversationId: string,
  streamId: string,
  onStop: () => void
): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        if (await consumeAgentStop(conversationId, streamId)) onStop();
      } catch (error) {
        console.error('[agent] stop-signal watch failed:', error);
      }
    })();
  }, STOP_WATCH_INTERVAL_MS);

  return () => clearInterval(timer);
}
