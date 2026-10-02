import 'server-only';
import { createTransport } from 'nodemailer';

/**
 * 邮件发送（server-only）—— 目前仅用于 Better Auth 的密码重置邮件。
 *
 * 通过 nodemailer + SMTP（阿里云 DirectMail / 任意 SMTP 服务）发送。配置读 env：
 * `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`。
 *
 * 安全默认：未配置 SMTP 时**不抛错**，仅 `console.warn` 并跳过发送——
 * 保证登录/注册等主链路在无 SMTP 环境（本地开发）下照常工作，重置邮件功能降级为不可用。
 */

export interface SendMailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** 解析 SMTP env；缺少 host/user/pass 任一视为未配置（返回 null） */
function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? '';
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !user || !pass || !from) return null;
  const port = Number.parseInt(process.env.SMTP_PORT ?? '465', 10);
  const secure = (process.env.SMTP_SECURE ?? 'true').trim().toLowerCase() !== 'false';
  return { host, port: Number.isFinite(port) ? port : 465, secure, user, pass, from };
}

let transporter: ReturnType<typeof createTransport> | null | undefined;

/** 懒加载 transporter：未配置 SMTP 时返回 null（单例缓存，避免每封邮件重建连接） */
function getTransporter(): ReturnType<typeof createTransport> | null {
  if (transporter !== undefined) return transporter;
  const config = getSmtpConfig();
  if (!config) {
    transporter = null;
    return null;
  }
  transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass }
  });
  return transporter;
}

/**
 * 发送邮件。返回 `true` 表示已投递给 SMTP，`false` 表示未配置 SMTP 而跳过。
 * 发送异常向上抛出（由 Better Auth 的 backgroundTasks 兜底，不阻塞认证响应）。
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  const config = getSmtpConfig();
  const transport = getTransporter();
  if (!config || !transport) {
    console.warn('[mailer] SMTP not configured; skipped sending password-reset mail');
    return false;
  }
  await transport.sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    ...(input.html ? { html: input.html } : {}),
    ...(input.text ? { text: input.text } : {})
  });
  return true;
}
