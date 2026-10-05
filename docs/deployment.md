# 部署

项目支持两种部署形态：**阿里云自托管（Docker，目标形态）** 与 **Vercel**。`next.config.ts` 在 `BUILD_STANDALONE=true` 时输出 `standalone`，为容器化自托管优化。

---

## 自托管（阿里云 ECS + Docker Compose）· 推荐

**架构**：ECS 上以 Docker Compose 运行 `web` 容器 + `nginx` 反向代理；数据库用阿里云 RDS PostgreSQL（**内网**访问）、缓存 Redis、对象存储 OSS、模型百炼——除计算外的组件本就都在阿里云，迁移只换计算层。

### 1. Nginx 关键配置（长请求与 SSE 必需）

| 配置 | 值 | 为什么 |
| --- | --- | --- |
| `proxy_read_timeout` | `300s` | 对话/视频生成单请求最长 ~295s；Nginx 默认 60s 会**截断**长请求 |
| `proxy_buffering` | `off` | **SSE 流式必须**——开启缓冲会把逐字输出攒成一次性返回，流式体验失效 |
| `client_max_body_size` | `12m` | 文件上传（知识库 10MB、头像等）|
| `proxy_http_version` | `1.1` | 配合 `Connection ""` 支持长连接/SSE |

```nginx
location / {
  proxy_pass http://web:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Connection "";
  proxy_read_timeout 300s;
  proxy_buffering off;
  client_max_body_size 12m;
}
```

### 2. OSS 内网访问（省流量 + 提速）

ECS 与 OSS **同地域**时置 `OSS_INTERNAL=true`：

- **走内网**：上传 / 删除 / 服务端拉取（`/raw` 图片与视频封面同源代理、头像代理）——免 OSS 公网流出流量费且更快；
- **始终公网**（不受该开关影响）：下发给浏览器/外部服务的签名 URL（资产预览 `previewUrl`、下载 302、**百炼参考图/首帧**）——这些地址必须公网可达；
- 未配置时行为与从前完全一致（本地开发无内网，保持不配即可）。

### 3. 健康检查

`GET /api/health` → `200 {"status":"ok"}`（仅进程存活探测，不查 DB/Redis）。用于 Docker `healthcheck` 与 Nginx upstream 探活。

### 4. `maxDuration` 与长请求

各 Route Handler 的 `export const maxDuration`（如 chat 的 300）是 **Vercel 平台声明**，**自托管下被忽略**（Node 常驻进程无实例级时长上限）——保留该导出无害（Vercel 上仍生效），真正约束来自上面的 Nginx `proxy_read_timeout`。

### 5. 时区

容器建议设 `TZ=Asia/Shanghai`（日志与时间展示；数据库列已带时区）。

### 6. 构建与运行

```bash
# 构建（NEXT_PUBLIC_* 变量需在构建时注入）
docker build --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com -t lv999-dashboard .

# 运行（运行时密钥经 -e / compose environment 注入）
docker run -d -p 3000:3000 \
  --restart unless-stopped \
  --health-cmd "wget -qO- http://127.0.0.1:3000/api/health || exit 1" \
  --health-interval 30s --health-timeout 5s --health-retries 3 \
  -e TZ=Asia/Shanghai \
  -e BETTER_AUTH_SECRET=your-32-plus-char-secret \
  -e BETTER_AUTH_URL=https://your-domain.com \
  -e DATABASE_URL=postgresql://user:pass@rds-internal:5432/db \
  -e REDIS_URL=redis://... \
  -e OSS_INTERNAL=true \
  --name lv999-dashboard \
  lv999-dashboard
```

生产环境建议用 `compose.yml` 管理 `web` + `nginx` 两容器（`nginx` 依赖 `web` 的 healthcheck 通过后再启动）。

### 7. 部署前本地实测清单（自托管独有的风险点）

- **napi 原生模块**：`anydoc`（文件解析）与 `sharp`（图片处理）在 linux-x64 镜像内正常加载（跑一遍上传解析 + 生图）；
- **流恢复**：对话进行中刷新页面能重连恢复（`after`/`waitUntil` 在常驻 Node 进程下的行为）；
- **构建内存**：Next 构建 + anydoc 在 2C2G 机器上可能吃紧（不足则升 4G，或把镜像构建放到 CI 再推送）。

---

## Vercel

连接仓库 → 在 Dashboard 配置环境变量 → 部署（历史形态，仍可用；`vercel.json` 已移除，无平台专属配置）。

---

## 生产环境变量

确保部署环境中设置了以下变量：

- `BETTER_AUTH_SECRET`（≥32 字符）与 `BETTER_AUTH_URL`（生产 HTTPS）
- `DATABASE_URL`；如需密码重置邮件另配 `SMTP_*`
- `ADMIN_USER_IDS`（Better Auth user id）用于管理后台
- `DASHSCOPE_API_KEY`（百炼）、`OSS_REGION`/`OSS_BUCKET`/`OSS_ACCESS_KEY_ID`/`OSS_ACCESS_KEY_SECRET`
- `REDIS_URL`（流恢复 / 停止信号 / 限流，需 pub/sub）
- `OSS_INTERNAL=true`（仅阿里云自托管、且 ECS 与 OSS 同地域时限）
- 所有用于客户端访问的 `NEXT_PUBLIC_*` 变量（Docker 构建阶段经 `--build-arg` 注入）

---

## Docker

包含两个生产就绪的 Dockerfile：`Dockerfile`（Node.js）和 `Dockerfile.bun`（Bun）。`NEXT_PUBLIC_*` 变量需在构建时通过 `--build-arg` 传入，运行时密钥通过 `-e` 传入（示例见上文「构建与运行」）。
