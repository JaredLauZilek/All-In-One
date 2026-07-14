// Minimal Telegram Bot API client.

export interface TgSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

export async function tgSendMessage(
  botToken: string,
  chatId: number | string,
  html: string,
  buttonUrl?: { text: string; url: string },
): Promise<TgSendResult> {
  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: false, prefer_small_media: true },
    };
    if (buttonUrl) {
      body.reply_markup = { inline_keyboard: [[{ text: buttonUrl.text, url: buttonUrl.url }]] };
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || `http_${res.status}` };
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
