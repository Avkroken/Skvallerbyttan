export const COPILOT_SECURITY_AGENT = "copilot-swe-agent[bot]";

type GithubRequest = (path: string, init?: RequestInit) => Promise<Response>;

type NativeRemediationResult = {
  handled: boolean;
  reason: "copilot-agent" | "dependabot-security-updates" | "fallback";
};

type DependabotSecurityUpdates = {
  enabled?: boolean;
  paused?: boolean;
};

function assigneeLogin(assignee: unknown): string {
  if (typeof assignee === "string") return assignee;
  if (!assignee || typeof assignee !== "object") return "";
  return String((assignee as { login?: unknown }).login ?? "");
}

function assigneeLogins(alert: unknown): string[] {
  if (!alert || typeof alert !== "object") return [];
  const assignees = (alert as { assignees?: unknown }).assignees;
  if (!Array.isArray(assignees)) return [];
  return assignees.map(assigneeLogin).filter(Boolean);
}

function hasCopilotAssignee(alert: unknown): boolean {
  return assigneeLogins(alert).some(
    (login) => login.toLowerCase() === COPILOT_SECURITY_AGENT.toLowerCase(),
  );
}

export function dependabotHasPatch(alert: unknown): boolean {
  if (!alert || typeof alert !== "object") return false;
  const vulnerability = (alert as { security_vulnerability?: unknown }).security_vulnerability;
  if (!vulnerability || typeof vulnerability !== "object") return false;
  const patched = (vulnerability as { first_patched_version?: unknown }).first_patched_version;
  if (!patched) return false;
  if (typeof patched === "string") return patched.trim().length > 0;
  if (typeof patched !== "object") return false;
  const identifier = (patched as { identifier?: unknown }).identifier;
  return typeof identifier === "string" && identifier.trim().length > 0;
}

async function currentAlert(request: GithubRequest, path: string): Promise<unknown | null> {
  try {
    const response = await request(path);
    return await response.json<unknown>();
  } catch {
    return null;
  }
}

async function assignCopilot(
  request: GithubRequest,
  path: string,
  dependabot: boolean,
): Promise<NativeRemediationResult> {
  const alert = await currentAlert(request, path);
  if (!alert) return { handled: false, reason: "fallback" };
  if (hasCopilotAssignee(alert)) return { handled: true, reason: "copilot-agent" };

  const assignees = assigneeLogins(alert);
  assignees.push(COPILOT_SECURITY_AGENT);
  const uniqueAssignees = [...new Set(assignees)];
  const body: Record<string, unknown> = { assignees: uniqueAssignees };
  if (dependabot) {
    body.agent_assignment = {
      custom_instructions: "Fix this security alert with the smallest safe change. Follow repository AGENTS.md and existing CI/merge rules. Do not dismiss the alert.",
    };
  }

  try {
    await request(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { handled: true, reason: "copilot-agent" };
  } catch {
    return { handled: false, reason: "fallback" };
  }
}

export async function tryNativeCodeScanningRemediation(
  request: GithubRequest,
  repo: string,
  alert: { number?: unknown },
): Promise<NativeRemediationResult> {
  const number = Number(alert?.number);
  if (!Number.isSafeInteger(number) || number <= 0) return { handled: false, reason: "fallback" };
  return assignCopilot(request, `/repos/${repo}/code-scanning/alerts/${number}`, false);
}

export async function tryNativeDependabotRemediation(
  request: GithubRequest,
  repo: string,
  alert: { number?: unknown },
  malware: boolean,
): Promise<NativeRemediationResult> {
  const number = Number(alert?.number);
  if (!Number.isSafeInteger(number) || number <= 0) return { handled: false, reason: "fallback" };

  if (!malware && dependabotHasPatch(alert)) {
    try {
      const response = await request(`/repos/${repo}/automated-security-fixes`);
      const status = await response.json<DependabotSecurityUpdates>();
      if (status.enabled !== false && status.paused !== true) {
        return { handled: true, reason: "dependabot-security-updates" };
      }
    } catch {
      // If the native security-update state cannot be verified, fall through to agent assignment.
    }
  }

  return assignCopilot(request, `/repos/${repo}/dependabot/alerts/${number}`, true);
}
