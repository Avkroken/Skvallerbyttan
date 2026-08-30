const API_VERSION = "2022-11-28";

type GithubRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SearchIssue = {
  number?: number;
  pull_request?: unknown;
};

async function githubRequest(
  token: string,
  path: string,
  init: RequestInit,
  request: GithubRequest,
): Promise<Response> {
  const response = await request(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "Avkroken-skvallerbyttan",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub issue reopen ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

export function closedSecurityIssueQuery(repo: string, marker: string): string {
  return `repo:${repo} is:issue is:closed in:body "${marker}"`;
}

export async function reopenClosedSecurityIssue(
  token: string,
  repo: string,
  marker: string,
  request: GithubRequest = fetch,
): Promise<number | null> {
  const query = closedSecurityIssueQuery(repo, marker);
  const search = await githubRequest(
    token,
    `/search/issues?q=${encodeURIComponent(query)}&per_page=1`,
    {},
    request,
  );
  const data = await search.json<{ items?: SearchIssue[] }>();
  const issue = data.items?.find((item) => !item.pull_request && Number.isSafeInteger(item.number));
  if (!issue?.number) return null;

  await githubRequest(
    token,
    `/repos/${repo}/issues/${issue.number}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "open" }),
    },
    request,
  );
  return issue.number;
}
