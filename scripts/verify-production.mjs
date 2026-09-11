import { pathToFileURL } from "node:url";

const HEALTH_URL = "https://skvallerbyttan.denied.se/healthz";
const READY_URL = "https://skvallerbyttan.denied.se/ready";
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 10_000;
const REQUEST_TIMEOUT_MS = 20_000;

export async function validateProductionResponse(response) {
  if (response.status !== 200) {
    throw new Error(`${HEALTH_URL} returned ${response.status}, expected 200`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(`${HEALTH_URL} returned unexpected content-type ${contentType || "<missing>"}`);
  }

  const body = await response.json();
  if (
    body?.ok !== true ||
    body?.service !== "skvallerbyttan" ||
    body?.purpose !== "github-dashboard"
  ) {
    throw new Error(`${HEALTH_URL} returned an unexpected health payload`);
  }
}

export function validateAccessResponse(response) {
  const location = response.headers.get("location");
  let url;
  try { url = new URL(location); } catch { throw new Error("Missing or invalid Access redirect"); }
  if (response.status !== 302 ||
      url.origin !== "https://mp100.cloudflareaccess.com" ||
      url.pathname !== "/cdn-cgi/access/login/skvallerbyttan.denied.se" ||
      url.username || url.password) {
    throw new Error("Protected readiness endpoint did not require expected Access login");
  }
}

export async function checkProduction({
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(HEALTH_URL, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "user-agent": "skvallerbyttan-workers-build-readiness-check" },
      });
      await validateProductionResponse(response);
      const protectedResponse = await fetchImpl(READY_URL, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      validateAccessResponse(protectedResponse);
      console.log(`skvallerbyttan: health and Access checks passed on attempt ${attempt}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`attempt ${attempt}: ${message}`);
      if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }

  throw new Error(`skvallerbyttan: health and Access checks failed after ${ATTEMPTS} attempts`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkProduction().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
