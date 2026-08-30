import coreWorker, { SkvallerbyttanIssueLock as CoreIssueLock } from "./index";
import { shouldClaimOperation, type OperationRecord } from "./idempotency";

type IssueSpec = { marker: string; title: string; body: string };

interface Env {
  SKVALLERBYTTAN_WEBHOOK_SECRET: string;
  SKVALLERBYTTAN_CLIENT_ID: string;
  SKVALLERBYTTAN_APP_PRIVATE_KEY: string;
  SKVALLERBYTTAN_EMAIL_TO: string;
  SKVALLERBYTTAN_EMAIL_FROM: string;
  EMAIL: SendEmail;
  SKVALLERBYTTAN_ISSUE_LOCK: DurableObjectNamespace<SkvallerbyttanIssueLock>;
}

const MAX_WEBHOOK_BYTES = 1024 * 1024;

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function verifySignature(raw: string, signature: string | null, secret: string): Promise<boolean> {
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

export class SkvallerbyttanIssueLock extends CoreIssueLock {
  private async claim(key: string, now = Date.now()): Promise<boolean> {
    return this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<OperationRecord>(key);
      if (!shouldClaimOperation(record, now)) return false;
      await transaction.put(key, { status: "processing", updatedAt: now } satisfies OperationRecord);
      return true;
    });
  }

  private async complete(key: string, now = Date.now()): Promise<void> {
    await this.ctx.storage.put(key, { status: "completed", updatedAt: now } satisfies OperationRecord);
  }

  private async release(key: string): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<OperationRecord>(key);
      if (record?.status === "processing") await transaction.delete(key);
    });
  }

  async createIssue(token: string, repo: string, issue: IssueSpec): Promise<"created" | "exists"> {
    if (!(await this.claim("issue"))) return "exists";
    try {
      const result = await super.createIssue(token, repo, issue);
      await this.complete("issue");
      return result;
    } catch (error) {
      await this.release("issue");
      throw error;
    }
  }

  async claimDelivery(): Promise<boolean> {
    return this.claim("delivery");
  }

  async completeDelivery(): Promise<void> {
    await this.complete("delivery");
  }

  async releaseDelivery(): Promise<void> {
    await this.release("delivery");
  }
}

async function fetchWithIdempotency(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (req.method !== "POST" || path !== "/webhook") {
    return coreWorker.fetch(req, env as Parameters<typeof coreWorker.fetch>[1], ctx);
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const raw = await req.clone().text();
  if (new TextEncoder().encode(raw).byteLength > MAX_WEBHOOK_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), env.SKVALLERBYTTAN_WEBHOOK_SECRET))) {
    return coreWorker.fetch(req, env as Parameters<typeof coreWorker.fetch>[1], ctx);
  }

  const delivery = req.headers.get("x-github-delivery") ?? "";
  if (!delivery) return coreWorker.fetch(req, env as Parameters<typeof coreWorker.fetch>[1], ctx);

  const lock = env.SKVALLERBYTTAN_ISSUE_LOCK.getByName(`delivery:${delivery}`);
  if (!(await lock.claimDelivery())) {
    console.log("skvallerbyttan duplicate delivery ignored", { delivery, event: req.headers.get("x-github-event") ?? "" });
    return new Response("duplicate\n");
  }

  try {
    const response = await coreWorker.fetch(req, env as Parameters<typeof coreWorker.fetch>[1], ctx);
    if (response.status >= 500) await lock.releaseDelivery();
    else await lock.completeDelivery();
    return response;
  } catch (error) {
    await lock.releaseDelivery();
    throw error;
  }
}

export default {
  fetch: fetchWithIdempotency,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    await coreWorker.scheduled(event, env as Parameters<typeof coreWorker.scheduled>[1], ctx);
  },
} satisfies ExportedHandler<Env>;
