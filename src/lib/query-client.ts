// 对齐 TanStack 官方 Next.js App Router 示例：
// https://github.com/TanStack/query/blob/main/examples/react/nextjs-app-prefetching/app/get-query-client.ts
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  environmentManager
} from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000
      },
      dehydrate: {
        // pending 查询一并脱水，客户端可续接流式 SSR 的同一个请求
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
        // 保留原始错误：Next.js 需要它识别动态页面，并会自行脱敏（带 digest）
        shouldRedactErrors: () => false
      }
    }
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  if (environmentManager.isServer()) {
    return makeQueryClient();
  } else {
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}
