export type AlertType = "code-scanning" | "dependabot" | "secret-scanning";
export type AlertReference = { number: number; type: AlertType };

export function alertReference(body: string): AlertReference | null {
  const match = body.match(/skvallerbyttan-alert:(code-scanning|dependabot|secret-scanning):(\d+)/);
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) && number > 0 ? { type: match[1] as AlertType, number } : null;
}

export function alertApiPath(repo: string, alert: AlertReference): string {
  return `/repos/${repo}/${alert.type}/alerts/${alert.number}`;
}

export function alertIsRemediated(alert: AlertReference, state: string): boolean {
  return alert.type === "secret-scanning" ? state === "resolved" : state === "fixed";
}

export function reconciledIssueState(alert: AlertReference, alertState: string): "closed" | "open" | null {
  if (alertIsRemediated(alert, alertState)) return "closed";
  return alertState === "open" ? "open" : null;
}

export function needsAssignee(assignees: Array<{ login?: string }>, expectedLogin: string): boolean {
  return !assignees.some(({ login }) => login?.toLowerCase() === expectedLogin.toLowerCase());
}
