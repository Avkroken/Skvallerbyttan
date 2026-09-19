import { authenticatedUserId } from "./auth";
import type { Env } from "./env";
import type { ReadConsumer } from "./telemetry";

const encoder = new TextEncoder();

export function secureTokenEqual(left: string | null, right: string): boolean {
  if (!left || !right) return false;
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const max = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < max; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

function bearer(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

export async function authorizeReadRequest(
  request: Request,
  env: Env,
): Promise<{ authorized: boolean; consumer: ReadConsumer; userId: number | null }> {
  const userId = await authenticatedUserId(request, env);
  if (userId) return { authorized: true, consumer: "dashboard", userId };

  const configured = env.SKVALLERBYTTAN_READ_API_TOKEN?.trim() || "";
  if (configured && secureTokenEqual(bearer(request), configured)) {
    return { authorized: true, consumer: "chatgpt", userId: null };
  }

  return { authorized: false, consumer: "internal", userId: null };
}
