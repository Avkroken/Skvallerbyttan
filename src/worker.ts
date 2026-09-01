import type { SkvallerbyttanBindings } from "./env";

type Env = SkvallerbyttanBindings & {
  SKVALLERBYTTAN_ISSUE_LOCK: DurableObjectNamespace<SkvallerbyttanIssueLock>;
};

/**
 * Tombstone class kept temporarily so the already-deployed Durable Object
 * migration remains valid while the service is being removed from Cloudflare.
 * It performs no GitHub or email writes and drains any stale alarm state.
 */
export class SkvallerbyttanIssueLock {
  constructor(private readonly ctx: DurableObjectState, _env: Env) {}

  async fetch(): Promise<Response> {
    return new Response("Skvallerbyttan is decommissioned.\n", { status: 410 });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/ready") {
      return Response.json({
        ok: true,
        service: "skvallerbyttan",
        check: "decommissioned",
      });
    }

    return new Response("Skvallerbyttan is decommissioned.\n", { status: 410 });
  },

  async scheduled(
    _event: ScheduledController,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Intentionally inert. The cron trigger is removed from wrangler.jsonc.
  },
} satisfies ExportedHandler<Env>;
