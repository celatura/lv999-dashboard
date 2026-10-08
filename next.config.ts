import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // shiki：@streamdown/code 的语法高亮运行时，需转置以消除 Next.js external 警告
  transpilePackages: ['geist', 'shiki'],
  // server-only 包不参与打包：ali-oss 的依赖 urllib 含惰性可选 require（proxy-agent），
  // 仅在启用代理时才会执行，Turbopack 静态解析会误报缺失；运行时由 Node 直接 require。
  // @firecrawl/anydoc 是 napi-rs 原生模块（.node 二进制），同样必须由 Node 运行时直接加载。
  // nodemailer 含大量可选传输方式的动态 require，交由 Node 运行时加载最稳妥。
  serverExternalPackages: ['ali-oss', '@firecrawl/anydoc', 'nodemailer'],
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css'
      }
    }
  }
};

export default nextConfig;
