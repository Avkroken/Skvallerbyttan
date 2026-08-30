import coreWorker, { handleVerifiedWebhook, SkvallerbyttanIssueLock as CoreIssueLock } from "./index";
import type { SkvallerbyttanBindings } from "./env";
import { shouldClaimOperation, type OperationRecord } from "./idempotency";
import { runtimeReady } from "./runtime-health";
import {
  declaredWebhookBodyTooLarge,
  githubDeliveryId,
  readWebhookBody,
  verifyWebhookSignature,
  WebhookBodyTooLargeError,
} from "./webhook-security";

type IssueSpec = { marker: string; title: string; body: string };
type Env = SkvallerbyttanBindings & {
  SKVALLERBYTTAN_ISSUE_LOCK: DurableObjectNamespace<SkvallerbyttanIssueLock>;
};

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
  if (req.method === "GET" && path === "/ready") {
    const ok = runtimeReady(env);
    return Response.json(
      { ok, service: "skvallerbyttan", check: "configuration" },
      { status: ok ? 200 : 503 },
    );
  }

  if (req.method !== "POST" || path !== "/webhook") {
    return coreWorker.fetch(req, env as Parameters<typeof coreWorker.fetch>[1], ctx);
  }

  if (declaredWebhookBodyTooLarge(req.headers.get("content-length"))) {
    return new Response("Payload too large", { status: 413 });
  }

  let raw: string;
  try {
    raw = await readWebhookBody(req.body);
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    throw error;
  }

  const delivery = githubDeliveryId(req.headers);
  const event = req.headers.get("x-github-event") ?? "";
  if (!(await verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), env.SKVALLERBYTTAN_WEBHOOK_SECRET))) {
    console.warn("skvallerbyttan webhook bad signature", { delivery: delivery ?? "", event });
    return new Response("Bad signature", { status: 401 });
  }

  if (!delivery) {
    console.warn("skvallerbyttan webhook missing delivery id", { event });
    return new Response("Missing delivery id", { status: 400 });
  }

  const lock = env.SKVALLERBYTTAN_ISSUE_LOCK.getByName(`delivery:${delivery}`);
  if (!(await lock.claimDelivery())) {
    console.log("skvallerbyttan duplicate delivery ignored", { delivery, event });
    return new Response("duplicate\n");
  }

  try {
    const response = await handleVerifiedWebhook(
      raw,
      req.headers,
      env as Parameters<typeof handleVerifiedWebhook>[2],
      ctx,
    );
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
