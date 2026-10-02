# 部署

本启动套件开箱即用地支持部署到 Vercel，或通过 Docker 部署到任何平台。`next.config.ts` 设置了 `output: 'standalone'`，因此生产构建已针对自托管进行了优化。

## Vercel（推荐）

1. 将仓库连接到 Vercel
2. 在 Dashboard 中添加环境变量
3. 部署

如需部署到其他平台，请参见 [Next.js 部署文档](https://nextjs.org/docs/app/getting-started/deploying)。

## 生产环境变量

确保在部署平台中设置了以下变量：

- `BETTER_AUTH_SECRET`（≥32 字符）与 `BETTER_AUTH_URL`（生产 HTTPS）
- `DATABASE_URL`；如需密码重置邮件另配 `SMTP_*`
- `ADMIN_USER_IDS`（Better Auth user id）用于管理后台
- 所有用于客户端访问的 `NEXT_PUBLIC_*` 变量

## Docker

包含两个生产就绪的 Dockerfile：`Dockerfile`（Node.js）和 `Dockerfile.bun`（Bun）。`NEXT_PUBLIC_*` 变量需在构建时通过 `--build-arg` 传入，运行时密钥通过 `-e` 传入。

构建镜像：

```bash
# Node.js
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com \
  -t lv999-dashboard .

# 或 Bun
docker build -f Dockerfile.bun \
  --build-arg NEXT_PUBLIC_APP_URL=https://your-domain.com \
  -t lv999-dashboard .
```

运行容器：

```bash
docker run -d -p 3000:3000 \
  -e BETTER_AUTH_SECRET=your-32-plus-char-secret \
  -e BETTER_AUTH_URL=https://your-domain.com \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  --restart unless-stopped \
  --name lv999-dashboard \
  lv999-dashboard
```
