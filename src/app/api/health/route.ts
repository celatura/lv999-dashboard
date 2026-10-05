export const runtime = 'nodejs';
/** 健康检查必须运行时执行（不得被构建期静态化） */
export const dynamic = 'force-dynamic';

/**
 * 健康检查端点（供 Docker healthcheck / Nginx upstream 探活 / 外部监控使用）。
 *
 * 只做**进程存活探测**（不查 DB/Redis）：外部依赖抖动不应让容器被判为不健康而误杀重启；
 * 且高频探活不应给下游施压。要验证依赖连通性请直接访问业务端点（如 /api/agent/credits）。
 * Vercel 部署时同样可用（返回 200 即实例健康）。
 */
export async function GET() {
  return Response.json(
    { status: 'ok' },
    {
      // 探活响应必须实时（禁止任何层级缓存）
      headers: { 'Cache-Control': 'no-store' }
    }
  );
}
