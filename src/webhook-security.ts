export const MAX_WEBHOOK_BYTES = 1024 * 1024;

export class WebhookBodyTooLargeError extends Error {
  constructor() {
    super(`Webhook body exceeds ${MAX_WEBHOOK_BYTES} bytes`);
    this.name = "WebhookBodyTooLargeError";
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export function declaredWebhookBodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null) return false;
  const declaredLength = Number(contentLength);
  return Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES;
}

export function webhookBodyTooLarge(raw: string): boolean {
  return new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES;
}

export async function readWebhookBody(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WebhookBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function verifyWebhookSignature(raw: string, signature: string | null, secret: string): Promise<boolean> {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return safeEqual(signature, `sha256=${hex(digest)}`);
}
