export type OperationRecord = {
  status: "processing" | "completed";
  updatedAt: number;
};

export const OPERATION_STALE_AFTER_MS = 10 * 60 * 1000;

export function shouldClaimOperation(
  record: OperationRecord | undefined,
  now: number,
  staleAfterMs = OPERATION_STALE_AFTER_MS,
): boolean {
  if (!record) return true;
  if (record.status === "completed") return false;
  return now - record.updatedAt >= staleAfterMs;
}
