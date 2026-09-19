import type { Env } from "./env";

const API_BASE = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

type CloudflareEnvelope<T> = {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
};

type UnknownRecord = Record<string, unknown>;

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

function credentials(env: Env): { accountId: string; token: string } {
  const accountId = env.SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  const token = env.SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN?.trim() || "";
  if (!ACCOUNT_ID.test(accountId) || !token) {
    throw new CloudflareApiError("cloudflare integration not configured", 503);
  }
  return { accountId, token };
}

export function cloudflareApiConfigured(env: Env): boolean {
  const accountId = env.SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID?.trim() || "";
  return ACCOUNT_ID.test(accountId) && Boolean(env.SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN?.trim());
}

async function cloudflareGet<T>(env: Env, path: string): Promise<T> {
  const { accountId, token } = credentials(env);
  const response = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}${path}`, {
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
    throw new CloudflareApiError("cloudflare returned invalid JSON", response.ok ? 502 : response.status);
  }

  if (!response.ok || envelope.success === false || envelope.result === undefined) {
    const firstError = envelope.errors?.find((error) => text(error.message));
    throw new CloudflareApiError(
      firstError?.message?.trim() || `cloudflare request failed (${response.status})`,
      response.status || 502,
    );
  }

  return envelope.result;
}

export async function getCloudflareNotificationHistory(env: Env): Promise<Record<string, unknown>> {
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/history?per_page=100");
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
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/policies");
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
  const rows = await cloudflareGet<unknown[]>(env, "/alerting/v3/destinations/webhooks");
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
  const rows = await cloudflareGet<unknown[]>(env, "/data-security/posture/webhooks");
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
