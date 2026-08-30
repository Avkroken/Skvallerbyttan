export const EMAIL_RETRY_MIN_MS = 60_000;
export const EMAIL_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export type QueuedEmail = {
  to: string;
  from: { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
};

export type EmailOutboxRecord = {
  message: QueuedEmail;
  attempts: number;
};

export function emailRetryDelayMs(attempts: number): number {
  const normalizedAttempts = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  const exponent = Math.min(normalizedAttempts - 1, 16);
  return Math.min(EMAIL_RETRY_MAX_MS, EMAIL_RETRY_MIN_MS * (2 ** exponent));
}

export function emailOutboxName(delivery: string): string {
  return `email:${delivery}`;
}

export function normalizeQueuedEmail(message: unknown): QueuedEmail {
  const candidate = message as {
    to?: unknown;
    from?: { email?: unknown; name?: unknown };
    subject?: unknown;
    text?: unknown;
    html?: unknown;
  };
  const to = String(candidate?.to ?? "").trim();
  const fromEmail = String(candidate?.from?.email ?? "").trim();
  const subject = String(candidate?.subject ?? "").trim();
  if (!to || !fromEmail || !subject) throw new Error("Queued email is missing required envelope fields");

  const name = String(candidate.from?.name ?? "").trim();
  const text = candidate.text === undefined ? undefined : String(candidate.text);
  const html = candidate.html === undefined ? undefined : String(candidate.html);
  return {
    to,
    from: { email: fromEmail, ...(name ? { name } : {}) },
    subject,
    ...(text === undefined ? {} : { text }),
    ...(html === undefined ? {} : { html }),
  };
}
