export const OBSERVATION_STATUSES = [
  "available",
  "unavailable",
  "permission_denied",
  "not_configured",
  "not_supported",
  "not_exposed_by_provider",
  "unknown",
  "not_observed",
  "stale",
  "error",
] as const;

export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type Provider = "github" | "cloudflare";
export type ProviderSupport = "supported" | "not_supported" | "not_exposed_by_provider" | "unknown";
export type PermissionState =
  | "granted"
  | "permission_denied"
  | "not_required"
  | "blocked_by_read_only_policy"
  | "unknown";
export type Freshness = "fresh" | "stale" | "unknown";

export type Provenance = {
  provider: Provider;
  source: string;
  scope: "organization" | "repository" | "account" | "zone" | "service";
  sourceId: string | null;
  direct: boolean;
  inherited: boolean;
  derived: boolean;
  retrievedAt: string;
};

export type CapabilityRuntimeState = {
  status: ObservationStatus;
  permissionState: PermissionState;
  dataState: ObservationStatus;
  freshness: Freshness;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
};

export function freshnessFromTimestamp(
  lastSuccessAt: string | null,
  ttlMs: number,
  nowMs = Date.now(),
): Freshness {
  if (!lastSuccessAt) return "unknown";
  const timestamp = Date.parse(lastSuccessAt);
  if (!Number.isFinite(timestamp)) return "unknown";
  return nowMs - timestamp <= ttlMs ? "fresh" : "stale";
}

export function statusFromHttp(status: number): Pick<CapabilityRuntimeState, "status" | "permissionState" | "dataState"> {
  if (status >= 200 && status < 300) {
    return { status: "available", permissionState: "granted", dataState: "available" };
  }
  if (status === 401 || status === 403) {
    return { status: "permission_denied", permissionState: "permission_denied", dataState: "unavailable" };
  }
  if (status === 404) {
    return { status: "unknown", permissionState: "unknown", dataState: "unknown" };
  }
  if (status === 0 || status === 408 || status === 429 || status >= 500) {
    return { status: "error", permissionState: "unknown", dataState: "error" };
  }
  return { status: "unavailable", permissionState: "unknown", dataState: "unavailable" };
}

export function effectiveStatus(input: {
  implemented: boolean;
  providerSupport: ProviderSupport;
  permissionState: PermissionState;
  dataState: ObservationStatus;
  freshness: Freshness;
}): ObservationStatus {
  if (!input.implemented) return "not_supported";
  if (input.providerSupport === "not_supported") return "not_supported";
  if (input.providerSupport === "not_exposed_by_provider") return "not_exposed_by_provider";
  if (input.permissionState === "permission_denied" || input.permissionState === "blocked_by_read_only_policy") {
    return "permission_denied";
  }
  if (input.dataState === "not_configured") return "not_configured";
  if (input.dataState === "not_observed") return "not_observed";
  if (input.dataState === "error") return "error";
  if (input.dataState === "unknown") return "unknown";
  if (input.freshness === "stale" && input.dataState === "available") return "stale";
  return input.dataState;
}

export function provenance(input: Omit<Provenance, "retrievedAt"> & { retrievedAt?: string }): Provenance {
  return {
    ...input,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
  };
}
