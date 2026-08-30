import { env } from '../config.js';
import { log } from '../logger.js';

export interface Notification {
  title: string;
  body: string;
  url?: string;
  level?: 'info' | 'hit' | 'error';
}

async function sendWebhook(n: Notification): Promise<void> {
  if (!env.webhookUrl) return;
  // Slack/Discord 는 text/content 필드를 쓰고, 그 외 웹훅은 전체 JSON 을 받습니다.
  const text = `*${n.title}*\n${n.body}${n.url ? `\n${n.url}` : ''}`;
  const payload = { text, content: text, ...n };
  const res = await fetch(env.webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`웹훅 ${res.status} ${await res.text().catch(() => '')}`);
}

async function sendTelegram(n: Notification): Promise<void> {
  if (!env.telegramToken || !env.telegramChatId) return;
  const text = `${n.title}\n${n.body}${n.url ? `\n${n.url}` : ''}`;
  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.telegramChatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`텔레그램 ${res.status} ${await res.text().catch(() => '')}`);
}

/** 설정된 모든 채널로 알림을 보냅니다. 알림 실패가 감시 루프를 죽이지 않도록 흡수합니다. */
export async function notify(n: Notification): Promise<void> {
  const line = `${n.title} — ${n.body}`;
  if (n.level === 'hit') log.hit(line);
  else if (n.level === 'error') log.error(line);
  else log.info(line);

  const results = await Promise.allSettled([sendWebhook(n), sendTelegram(n)]);
  for (const r of results) {
    if (r.status === 'rejected') log.warn(`알림 전송 실패: ${(r.reason as Error).message}`);
  }
}
