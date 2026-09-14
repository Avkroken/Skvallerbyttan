import type { Env } from "./env";
import worker from "./worker";

const ROBOTS_BODY = "User-agent: *\nAllow: /\n";
const NOINDEX = "noindex, nofollow, noarchive";

function withNoIndex(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", NOINDEX);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/robots.txt") {
      return new Response(ROBOTS_BODY, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "X-Robots-Tag": "noindex",
        },
      });
    }

    if (url.pathname === "/sitemap.xml") {
      return new Response("Not Found\n", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          "X-Robots-Tag": "noindex",
        },
      });
    }

    return withNoIndex(await worker.fetch(request, env, context));
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    return worker.scheduled(controller, env, context);
  },
};
