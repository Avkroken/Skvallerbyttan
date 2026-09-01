const TRIVY_BASELINE_ONLY_REPOS = new Set([
  "avkroken/docker-idempotent-update",
  "avkroken/produkter",
]);

type CodeScanningAlert = {
  rule?: { id?: string; name?: string };
  tool?: { name?: string };
};

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function codeScanningAlertCreatesIssue(repo: string, alert: CodeScanningAlert): boolean {
  if (!TRIVY_BASELINE_ONLY_REPOS.has(repo.toLowerCase())) return true;

  const tool = normalized(alert.tool?.name);
  const rule = normalized(alert.rule?.name ?? alert.rule?.id);
  return !(tool === "trivy" && rule === "ospackagevulnerability");
}
