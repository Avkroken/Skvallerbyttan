import {
  cloudflareAccountId,
  cloudflareApiToken,
  type CloudflareReadCredentialClass,
  type Env,
} from "./env";

const API_BASE = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type CloudflareResultInfo = {
  count?: number;
  page?: number;
  per_page?: number;
  total_count?: number;
  total_pages?: number;
  cursor?: string;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  result_info?: CloudflareResultInfo;
  errors?: Array<{ code?: number; message?: string }>;
};

type PagedResult<T> = {
  items: T[];
  truncated: boolean;
  totalCount: number | null;
};

type UnknownRecord = Record<string, unknown>;

export type CloudflareBudget = {
  remaining: number | null;
  resetAt: string | null;
  retryAfterSeconds: number | null;
  rateLimit: string | null;
  policy: string | null;
  throttled: boolean;
  lastStatus: number | null;
  lastError: string | null;
  observedAt: string | null;
};

let budget: CloudflareBudget = {
  remaining: null,
  resetAt: null,
  retryAfterSeconds: null,
  rateLimit: null,
  policy: null,
  throttled: false,
  lastStatus: null,
  lastError: null,
  observedAt: null,
};

export class CloudflareApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function credentials(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): { accountId: string; token: string } {
  const accountId = cloudflareAccountId(env);
  const token = cloudflareApiToken(env, credentialClass);
  if (!ACCOUNT_ID.test(accountId) || !token) {
    throw new CloudflareApiError(`cloudflare ${credentialClass} integration not configured`, 503);
  }
  return { accountId, token };
}

export function cloudflareApiConfigured(env: Env): boolean {
  const accountId = cloudflareAccountId(env);
  return ACCOUNT_ID.test(accountId)
    && (Boolean(cloudflareApiToken(env, "r1"))
      || Boolean(cloudflareApiToken(env, "r2"))
      || Boolean(cloudflareApiToken(env, "r3")));
}

function captureBudget(response: Response, error: string | null = null): void {
  const rateLimit = response.headers.get("ratelimit");
  const remainingMatch = rateLimit?.match(/(?:^|[;,])\\s*r=(\\d+)/i);
  const resetMatch = rateLimit?.match(/(?:^|[;,])\\s*t=(\\d+)/i);
  const retryAfter = Number(response.headers.get("retry-after"));
  const resetSeconds = resetMatch ? Number(resetMatch[1]) : null;
  budget = {
    remaining: remainingMatch ? Number(remainingMatch[1]) : null,
    resetAt: resetSeconds != null && Number.isFinite(resetSeconds)
      ? new Date(Date.now() + resetSeconds * 1000).toISOString()
      : null,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
    rateLimit,
    policy: response.headers.get("ratelimit-policy"),
    throttled: response.status === 429,
    lastStatus: response.status,
    lastError: error,
    observedAt: new Date().toISOString(),
  };
}

export function getCloudflareBudget(): CloudflareBudget {
  return { ...budget };
}

async function cloudflareEnvelopeUrl<T>(
  env: Env,
  url: string,
  credentialClass: CloudflareReadCredentialClass,
): Promise<CloudflareEnvelope<T>> {
  const { token } = credentials(env, credentialClass);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  let envelope: CloudflareEnvelope<T>;
  try {
    envelope = await response.json() as CloudflareEnvelope<T>;
  } catch {
    captureBudget(response, "invalid-json");
    throw new CloudflareApiError("cloudflare returned invalid JSON", response.ok ? 502 : response.status);
  }

  if (!response.ok || envelope.success === false || envelope.result === undefined) {
    const firstError = envelope.errors?.find((error) => text(error.message));
    const message = firstError?.message?.trim() || `cloudflare request failed (${response.status})`;
    captureBudget(response, message);
    throw new CloudflareApiError(message, response.status || 502);
  }

  captureBudget(response);
  return envelope;
}

async function cloudflareGetUrl<T>(
  env: Env,
  url: string,
  credentialClass: CloudflareReadCredentialClass,
): Promise<T> {
  const envelope = await cloudflareEnvelopeUrl<T>(env, url, credentialClass);
  return envelope.result as T;
}

async function cloudflareGet<T>(
  env: Env,
  path: string,
  credentialClass: CloudflareReadCredentialClass,
): Promise<T> {
  const { accountId } = credentials(env, credentialClass);
  return cloudflareGetUrl<T>(
    env,
    `${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`,
    credentialClass,
  );
}

function pagePath(path: string, page: number): string {
  return `${path}${path.includes("?") ? "&" : "?"}page=${page}`;
}

async function cloudflareListAll<T>(
  env: Env,
  path: string,
  options: {
    credentialClass: CloudflareReadCredentialClass;
    root?: boolean;
    maxPages?: number;
  },
): Promise<PagedResult<T>> {
  const { accountId } = credentials(env, options.credentialClass);
  const maxPages = Math.min(20, Math.max(1, options.maxPages ?? 10));
  const items: T[] = [];
  let totalCount: number | null = null;
  let page = 1;
  let hasMore = false;

  while (page <= maxPages) {
    const currentPath = pagePath(path, page);
    const url = options.root
      ? `${API_BASE}${currentPath}`
      : `${API_BASE}/accounts/${encodeURIComponent(accountId)}${currentPath}`;
    const envelope = await cloudflareEnvelopeUrl<T[]>(env, url, options.credentialClass);
    const result = Array.isArray(envelope.result) ? envelope.result : [];
    items.push(...result);

    const info = envelope.result_info;
    totalCount = typeof info?.total_count === "number" ? info.total_count : totalCount;
    const totalPages = typeof info?.total_pages === "number"
      ? info.total_pages
      : typeof info?.total_count === "number" && typeof info?.per_page === "number" && info.per_page > 0
        ? Math.ceil(info.total_count / info.per_page)
        : null;

    if (totalPages != null) {
      hasMore = page < totalPages;
    } else if (typeof info?.count === "number" && typeof info?.per_page === "number") {
      hasMore = info.count >= info.per_page && info.per_page > 0;
    } else {
      hasMore = false;
    }

    if (!hasMore) break;
    page += 1;
  }

  return {
    items,
    truncated: hasMore,
    totalCount,
  };
}

async function cloudflareR2BucketsAll(
  env: Env,
  maxPages = 10,
): Promise<PagedResult<unknown>> {
  const { accountId } = credentials(env, "r1");
  const items: unknown[] = [];
  let cursor: string | null = null;
  let hasMore = false;
  const seen = new Set<string>();

  for (let page = 0; page < Math.min(20, Math.max(1, maxPages)); page += 1) {
    const query = new URLSearchParams({ per_page: "100" });
    if (cursor) query.set("cursor", cursor);
    const envelope = await cloudflareEnvelopeUrl<UnknownRecord>(
      env,
      `${API_BASE}/accounts/${encodeURIComponent(accountId)}/r2/buckets?${query}`,
      "r1",
    );
    items.push(...array(envelope.result?.buckets));
    const nextCursor = text(envelope.result_info?.cursor);
    hasMore = Boolean(nextCursor);
    if (!nextCursor || seen.has(nextCursor)) {
      hasMore = false;
      break;
    }
    seen.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    items,
    truncated: hasMore,
    totalCount: null,
  };
}

export async function getCloudflareNotificationHistory(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/history?per_page=100", "r2");
  const items = array(rows).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    return [{
      id: text(row.id),
      alertType: text(row.alert_type),
      description: text(row.description),
      mechanismType: text(row.mechanism_type),
      name: text(row.name),
      policyId: text(row.policy_id),
      sent: text(row.sent),
    }];
  });
  return { available: true, count: items.length, items };
}

export async function getCloudflareNotificationPolicies(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/policies", "r2");
  const items = array(rows).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    return [{
      id: text(row.id),
      name: text(row.name),
      description: text(row.description),
      alertType: text(row.alert_type),
      alertInterval: text(row.alert_interval),
      enabled: bool(row.enabled),
    }];
  });
  return { available: true, count: items.length, items };
}

export async function getCloudflareNotificationWebhooks(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/destinations/webhooks", "r2");
  const items = array(rows).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    return [{
      id: text(row.id),
      name: text(row.name),
      type: text(row.type),
      createdAt: text(row.created_at),
      lastSuccess: text(row.last_success),
      lastFailure: text(row.last_failure),
    }];
  });
  return { available: true, count: items.length, items };
}

export async function getCloudflareCasbWebhooks(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/data-security/posture/webhooks", "r3");
  const items = array(rows).flatMap((value) => {
    const row = record(value);
    if (!row) return [];
    const headers = array(row.headers).flatMap((headerValue) => {
      const header = record(headerValue);
      const key = header ? text(header.key) : null;
      return key ? [key] : [];
    });
    return [{
      id: text(row.id),
      label: text(row.label),
      authenticationType: text(row.authentication_type),
      status: text(row.status),
      version: number(row.version),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      headerKeys: headers,
    }];
  });
  return { available: true, count: items.length, items };
}


export async function getCloudflareAccount(env: Env): Promise<Record<string, unknown>> {
  const account = await cloudflareGet<UnknownRecord>(env, "", "r2");
  return {
    schemaVersion: 1,
    available: true,
    id: text(account.id),
    name: text(account.name),
    type: text(account.type),
    createdOn: text(account.created_on),
  };
}

export async function getCloudflareZones(env: Env): Promise<Record<string, unknown>> {
  const { accountId } = credentials(env, "r1");
  const page = await cloudflareListAll<unknown>(
    env,
    `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50&order=name&direction=asc`,
    { root: true, credentialClass: "r1" },
  );
  const items = page.items.flatMap((value) => {
    const zone = record(value);
    if (!zone) return [];
    const plan = record(zone.plan);
    return [{
      id: text(zone.id),
      name: text(zone.name),
      status: text(zone.status),
      type: text(zone.type),
      paused: bool(zone.paused),
      developmentMode: number(zone.development_mode),
      plan: plan ? text(plan.name) : null,
      createdOn: text(zone.created_on),
      activatedOn: text(zone.activated_on),
      modifiedOn: text(zone.modified_on),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}

export async function getCloudflareWorkers(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/workers/scripts", "r1");
  const items = array(rows).flatMap((value) => {
    const worker = record(value);
    if (!worker) return [];
    const observability = record(worker.observability);
    return [{
      id: text(worker.id),
      createdOn: text(worker.created_on),
      modifiedOn: text(worker.modified_on),
      compatibilityDate: text(worker.compatibility_date),
      compatibilityFlags: array(worker.compatibility_flags).flatMap((flag) => text(flag) ? [text(flag)!] : []),
      usageModel: text(worker.usage_model),
      handlers: array(worker.handlers).flatMap((handler) => text(handler) ? [text(handler)!] : []),
      observability: observability ? {
        enabled: bool(observability.enabled),
        headSamplingRate: number(observability.head_sampling_rate),
      } : null,
    }];
  });
  return { schemaVersion: 1, available: true, count: items.length, items };
}

export function normalizeCloudflareAuditLog(value: unknown): Record<string, unknown> | null {
  const row = record(value);
  if (!row) return null;
  const action = record(row.action);
  const actor = record(row.actor);
  const resource = record(row.resource);
  const zone = record(row.zone);
  return {
    id: text(row.id),
    actor: actor ? {
      id: text(actor.id),
      type: text(actor.type),
      context: text(actor.context),
      email: text(actor.email),
    } : null,
    action: action ? {
      type: text(action.type),
      description: text(action.description),
      result: text(action.result),
    } : null,
    resource: resource ? {
      id: text(resource.id),
      type: text(resource.type),
      product: text(resource.product),
    } : null,
    zone: zone ? {
      id: text(zone.id),
      name: text(zone.name),
    } : null,
    occurredAt: action ? text(action.time) : null,
  };
}

export async function getCloudflareAuditLogs(
  env: Env,
  requestedDays = 7,
): Promise<Record<string, unknown>> {
  const days = Math.min(30, Math.max(1, Math.trunc(Number.isFinite(requestedDays) ? requestedDays : 7)));
  const before = new Date().toISOString();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await cloudflareGet<unknown[]>(
    env,
    `/logs/audit?since=${encodeURIComponent(since)}&before=${encodeURIComponent(before)}&direction=desc&limit=200`,
    "r2",
  );
  const items = array(rows).flatMap((value) => {
    const normalized = normalizeCloudflareAuditLog(value);
    return normalized ? [normalized] : [];
  });
  return {
    schemaVersion: 1,
    available: true,
    days,
    period: { since, before },
    count: items.length,
    items,
    coverage: {
      source: "audit_log",
      coverage: "partial",
      periodComplete: false,
      sampling: "first-page-up-to-200",
    },
  };
}


export async function getCloudflareD1Databases(env: Env): Promise<Record<string, unknown>> {
  const page = await cloudflareListAll<unknown>(env, "/d1/database?per_page=100", { credentialClass: "r1" });
  const items = page.items.flatMap((value) => {
    const database = record(value);
    if (!database) return [];
    return [{
      uuid: text(database.uuid),
      name: text(database.name),
      version: text(database.version),
      jurisdiction: text(database.jurisdiction),
      createdAt: text(database.created_at),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}

export async function getCloudflareKvNamespaces(env: Env): Promise<Record<string, unknown>> {
  const page = await cloudflareListAll<unknown>(env, "/storage/kv/namespaces?per_page=100", { credentialClass: "r1" });
  const items = page.items.flatMap((value) => {
    const namespace = record(value);
    if (!namespace) return [];
    return [{
      id: text(namespace.id),
      title: text(namespace.title),
      supportsUrlEncoding: bool(namespace.supports_url_encoding),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}

export async function getCloudflareR2Buckets(env: Env): Promise<Record<string, unknown>> {
  const page = await cloudflareR2BucketsAll(env);
  const items = page.items.flatMap((value) => {
    const bucket = record(value);
    if (!bucket) return [];
    return [{
      name: text(bucket.name),
      creationDate: text(bucket.creation_date),
      jurisdiction: text(bucket.jurisdiction),
      location: text(bucket.location),
      storageClass: text(bucket.storage_class),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}

export async function getCloudflareAccessApplications(env: Env): Promise<Record<string, unknown>> {
  const page = await cloudflareListAll<unknown>(env, "/access/apps?per_page=100", { credentialClass: "r3" });
  const items = page.items.flatMap((value) => {
    const application = record(value);
    if (!application) return [];
    const policies = array(application.policies).flatMap((policyValue) => {
      const policy = record(policyValue);
      if (!policy) return [];
      return [{
        id: text(policy.id),
        name: text(policy.name),
        decision: text(policy.decision),
        precedence: number(policy.precedence),
      }];
    });
    return [{
      id: text(application.id),
      name: text(application.name),
      type: text(application.type),
      domain: text(application.domain),
      appLauncherVisible: bool(application.app_launcher_visible),
      sessionDuration: text(application.session_duration),
      policies,
      createdAt: text(application.created_at),
      updatedAt: text(application.updated_at),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}

export async function getCloudflareTunnels(env: Env): Promise<Record<string, unknown>> {
  const page = await cloudflareListAll<unknown>(
    env,
    "/tunnels?per_page=100&is_deleted=false",
    { credentialClass: "r3" },
  );
  const items = page.items.flatMap((value) => {
    const tunnel = record(value);
    if (!tunnel) return [];
    return [{
      id: text(tunnel.id),
      name: text(tunnel.name),
      status: text(tunnel.status),
      remoteConfig: bool(tunnel.remote_config),
      configSource: text(tunnel.config_src),
      type: text(tunnel.tun_type),
      createdAt: text(tunnel.created_at),
      deletedAt: text(tunnel.deleted_at),
    }];
  });
  return {
    schemaVersion: 1,
    available: true,
    count: items.length,
    totalCount: page.totalCount,
    truncated: page.truncated,
    items,
  };
}
