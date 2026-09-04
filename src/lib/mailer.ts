import nodemailer, { type Transporter } from "nodemailer";

export interface MailerConfig {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

export function getMailerConfig(): MailerConfig {
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : undefined,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
  };
}

/** Доступен ли SMTP (настроены ли обязательные переменные). */
export function isMailerConfigured(cfg: MailerConfig = getMailerConfig()): boolean {
  return Boolean(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.from);
}

let transporter: Transporter | null = null;
function getTransporter(cfg: MailerConfig): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }
  return transporter;
}

export interface SendResult {
  sent: boolean;
  to: string[];
  dryRun: boolean;
}

/**
 * Отправка письма. Если SMTP не настроен — режим dry-run: ничего не отправляем,
 * но возвращаем успех (чтобы cron/cron not падали). В проде просто вернуть ok.
 */
export async function sendMail(
  to: string[],
  subject: string,
  html: string,
  text: string,
  cfg: MailerConfig = getMailerConfig(),
): Promise<SendResult> {
  if (!to.length) return { sent: true, to: [], dryRun: false };
  if (!isMailerConfigured(cfg)) {
    console.info("[digest] SMTP не настроен — dry-run, письмо не отправлено:", { to, subject });
    return { sent: true, to, dryRun: true };
  }
  const t = getTransporter(cfg);
  await t.sendMail({ from: cfg.from, to: to.join(", "), subject, html, text });
  return { sent: true, to, dryRun: false };
}

export function getRecipients(cfg: MailerConfig = getMailerConfig()): string[] {
  return (process.env.DIGEST_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
