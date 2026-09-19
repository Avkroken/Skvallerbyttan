import type { Env } from "./env";
import { organization } from "./env";
import {
  githubListAll,
  githubOptionalJson,
  mapLimit,
  type ListResult,
  type OptionalResult,
} from "./github";
import { recordCapabilityObservation } from "./capabilities";
import { provenance } from "./observation-model";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeObject(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeObject(item, depth + 1));
  const input = record(value);
  if (!input) return null;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(input)) {
    if (/(secret|token|private[_-]?key|authorization|credential|password)/i.test(key)) continue;
    output[key] = safeObject(item, depth + 1);
  }
  return output;
}

function section<T>(result: OptionalResult<T> | ListResult<T>): Record<string, unknown> {
  if (!result.available) {
    return {
      status: result.status === 401 || result.status === 403 ? "permission_denied" : result.status === 0 ? "error" : "unknown",
      available: false,
      httpStatus: result.status,
      reason: result.reason,
    };
  }
  return {
    status: "available",
    available: true,
    httpStatus: result.status,
    value: result.value,
    ...("truncated" in result ? { truncated: result.truncated } : {}),
  };
}

async function observeResult<T>(
  env: Env,
  capability: string,
  result: OptionalResult<T> | ListResult<T>,
): Promise<void> {
  await recordCapabilityObservation(env, capability, result.available
    ? { status: "available", permissionState: "granted", dataState: "available", httpStatus: result.status }
    : { httpStatus: result.status, error: result.reason });
}

export type NormalizedActor = {
  id: number | null;
  type: string | null;
  name: string | null;
  slug: string | null;
  resolved: boolean;
};

export function normalizeActor(value: unknown): NormalizedActor {
  const item = record(value) ?? {};
  return {
    id: integer(item.id),
    type: text(item.type),
    name: text(item.name),
    slug: text(item.slug),
    resolved: Boolean(item.resolved && (text(item.name) || text(item.slug))),
  };
}

export function normalizeActionsPolicy(value: unknown): Record<string, unknown> {
  const policy = record(value) ?? {};
  const conditions = record(policy.conditions) ?? {};
  const workflowPath = record(conditions.workflow_path);
  const rules = array(policy.rules).flatMap((ruleValue) => {
    const rule = record(ruleValue);
    if (!rule) return [];
    const parameters = record(rule.parameters) ?? {};
    if (rule.type === "restrict_action_events") {
      return [{
        type: "restrict_action_events",
        allowedEvents: array(parameters.allowed_events).flatMap((item) => text(item) ? [text(item)!] : []),
      }];
    }
    if (rule.type === "restrict_actions_actors") {
      return [{
        type: "restrict_actions_actors",
        allowedActors: array(parameters.allowed_actors).map(normalizeActor),
      }];
    }
    return [{ type: text(rule.type) ?? "unknown", parameters: safeObject(parameters) }];
  });

  return {
    id: integer(policy.id),
    name: text(policy.name),
    target: text(policy.target),
    enforcement: text(policy.enforcement),
    source: text(policy.source),
    sourceType: text(policy.source_type),
    conditions: {
      repositoryName: safeObject(conditions.repository_name),
      repositoryId: safeObject(conditions.repository_id),
      repositoryProperty: safeObject(conditions.repository_property),
      workflowPath: workflowPath ? {
        include: array(workflowPath.include).flatMap((item) => text(item) ? [text(item)!] : []),
        exclude: array(workflowPath.exclude).flatMap((item) => text(item) ? [text(item)!] : []),
      } : null,
    },
    rules,
    bypassActors: array(policy.bypass_actors).map(normalizeActor),
  };
}

function wildcardMatch(pattern: string, value: string): boolean {
  if (pattern === "~ALL") return true;
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      regex += ".*";
      index += 1;
      continue;
    }
    if (character === "*") {
      regex += "[^/]*";
      continue;
    }
    if ("\\^$.*+?()[]{}|".includes(character)) regex += "\\" + character;
    else regex += character;
  }
  regex += "$";
  return new RegExp(regex).test(value);
}

export function workflowPathMatches(
  condition: { include?: string[]; exclude?: string[] } | null | undefined,
  path: string,
): boolean {
  if (!condition) return true;
  const include = condition.include ?? [];
  const exclude = condition.exclude ?? [];
  if (exclude.some((pattern) => wildcardMatch(pattern, path))) return false;
  if (include.length === 0) return true;
  return include.some((pattern) => wildcardMatch(pattern, path));
}

export function evaluateWorkflowEventPolicies(
  policies: unknown[],
  workflowPath: string,
  event: string,
): Record<string, unknown> {
  const normalized = policies.map(normalizeActionsPolicy).filter((policy) => policy.enforcement !== "disabled");
  const applicable = normalized.filter((policy) => {
    const conditions = record(policy.conditions);
    const workflow = record(conditions?.workflowPath);
    return workflowPathMatches(workflow ? {
      include: array(workflow.include).map(String),
      exclude: array(workflow.exclude).map(String),
    } : null, workflowPath);
  });

  const restrictions = applicable.flatMap((policy) => array(policy.rules).flatMap((ruleValue) => {
    const rule = record(ruleValue);
    if (!rule || rule.type !== "restrict_action_events") return [];
    return [{
      policyId: policy.id,
      policyName: policy.name,
      allowedEvents: array(rule.allowedEvents).map(String),
    }];
  }));
  const blockers = restrictions.filter((rule) => !rule.allowedEvents.includes(event));

  return {
    status: blockers.length > 0 ? "blocked" : restrictions.length > 0 ? "allowed" : "not_restricted",
    workflowPath,
    event,
    matchingPolicies: applicable.map((policy) => ({ id: policy.id, name: policy.name, enforcement: policy.enforcement })),
    blockers,
  };
}

export function normalizeRuleset(value: unknown, retrievedAt = new Date().toISOString()): Record<string, unknown> {
  const ruleset = record(value) ?? {};
  const sourceType = text(ruleset.source_type);
  const direct = sourceType === "Repository";
  return {
    id: integer(ruleset.id),
    name: text(ruleset.name),
    target: text(ruleset.target),
    enforcement: text(ruleset.enforcement),
    source: text(ruleset.source),
    sourceType,
    conditions: safeObject(ruleset.conditions),
    rules: array(ruleset.rules).map((item) => {
      const rule = record(item) ?? {};
      return { type: text(rule.type) ?? "unknown", parameters: safeObject(rule.parameters) };
    }),
    bypassActors: array(ruleset.bypass_actors).map(normalizeActor),
    provenance: provenance({
      provider: "github",
      source: "repository-rulesets-api",
      scope: "repository",
      sourceId: integer(ruleset.id)?.toString() ?? null,
      direct,
      inherited: !direct,
      derived: false,
      retrievedAt,
    }),
  };
}

export function normalizeCustomPropertyDefinition(value: unknown): Record<string, unknown> {
  const item = record(value) ?? {};
  return {
    name: text(item.property_name),
    description: text(item.description),
    type: text(item.value_type),
    allowedValues: array(item.allowed_values).flatMap((entry) => text(entry) ? [text(entry)!] : []),
    defaultValue: safeObject(item.default_value),
    required: bool(item.required),
    requireExplicitValues: bool(item.require_explicit_values),
    valuesEditableBy: text(item.values_editable_by),
    source: text(item.source_type),
  };
}

export function normalizeSecurityConfiguration(value: unknown): Record<string, unknown> {
  const item = record(value) ?? {};
  const fields = [
    "advanced_security",
    "dependency_graph",
    "dependency_graph_autosubmit_action",
    "dependabot_alerts",
    "dependabot_security_updates",
    "code_scanning_default_setup",
    "code_scanning_delegated_alert_dismissal",
    "secret_scanning",
    "secret_scanning_push_protection",
    "secret_scanning_delegated_bypass",
    "secret_scanning_validity_checks",
    "secret_scanning_non_provider_patterns",
    "secret_scanning_generic_secrets",
    "secret_scanning_delegated_alert_dismissal",
    "private_vulnerability_reporting",
    "enforcement",
  ];
  const settings: UnknownRecord = {};
  for (const field of fields) settings[field] = safeObject(item[field]);
  return {
    id: integer(item.id),
    name: text(item.name),
    description: text(item.description),
    targetType: text(item.target_type),
    settings,
    createdAt: text(item.created_at),
    updatedAt: text(item.updated_at),
  };
}

export async function getGitHubOrganizationGovernance(env: Env): Promise<Record<string, unknown>> {
  const org = organization(env);
  const encoded = encodeURIComponent(org);
  const [
    actionsPermissions,
    selectedActions,
    workflowPermissions,
    propertySchema,
    propertyValues,
    securityConfigurations,
    securityDefaults,
  ] = await Promise.all([
    githubOptionalJson<UnknownRecord>(env, `/orgs/${encoded}/actions/permissions`),
    githubOptionalJson<UnknownRecord>(env, `/orgs/${encoded}/actions/permissions/selected-actions`),
    githubOptionalJson<UnknownRecord>(env, `/orgs/${encoded}/actions/permissions/workflow`),
    githubListAll<UnknownRecord>(env, `/orgs/${encoded}/properties/schema?per_page=100`, 5),
    githubListAll<UnknownRecord>(env, `/orgs/${encoded}/properties/values?per_page=100`, 20),
    githubListAll<UnknownRecord>(env, `/orgs/${encoded}/code-security/configurations?per_page=100`, 10),
    githubOptionalJson<unknown[]>(env, `/orgs/${encoded}/code-security/configurations/defaults`),
  ]);

  await Promise.all([
    observeResult(env, "github.avkroken.organization.actions_permissions", actionsPermissions),
    observeResult(env, "github.avkroken.custom_properties", propertySchema),
    observeResult(env, "github.avkroken.security_configurations", securityConfigurations),
  ]);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    organization: org,
    actions: {
      permissions: section(actionsPermissions),
      selectedActions: section(selectedActions),
      workflowPermissions: section(workflowPermissions),
      policies: {
        status: "permission_denied",
        available: false,
        permissionState: "blocked_by_read_only_policy",
        reason: "GitHub requires Administration (organization): write to GET organization Actions policies. Skvallerbyttan will not request write permission for observation.",
      },
    },
    rulesets: {
      status: "permission_denied",
      available: false,
      permissionState: "blocked_by_read_only_policy",
      reason: "GitHub requires Administration (organization): write to GET organization rulesets. Effective inherited rulesets are read per repository instead.",
    },
    customProperties: {
      definitions: propertySchema.available
        ? { ...section(propertySchema), value: propertySchema.value.map(normalizeCustomPropertyDefinition) }
        : section(propertySchema),
      assignments: section(propertyValues),
    },
    securityConfigurations: {
      configurations: securityConfigurations.available
        ? { ...section(securityConfigurations), value: securityConfigurations.value.map(normalizeSecurityConfiguration) }
        : section(securityConfigurations),
      defaults: securityDefaults.available
        ? { ...section(securityDefaults), value: securityDefaults.value.map((item) => {
          const entry = record(item);
          return {
            defaultForNewRepos: text(entry?.default_for_new_repos),
            configuration: normalizeSecurityConfiguration(entry?.configuration),
          };
        }) }
        : section(securityDefaults),
    },
  };
}

export async function getGitHubRepositoryEffectivePolicy(
  env: Env,
  repoName: string,
): Promise<Record<string, unknown>> {
  const org = organization(env);
  const encodedRepo = `${encodeURIComponent(org)}/${encodeURIComponent(repoName)}`;
  const retrievedAt = new Date().toISOString();
  const [rulesets, actions, selectedActions, workflowPermissions, properties, securityConfiguration] = await Promise.all([
    githubListAll<UnknownRecord>(env, `/repos/${encodedRepo}/rulesets?includes_parents=true&per_page=100`, 5),
    githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/actions/permissions`),
    githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/actions/permissions/selected-actions`),
    githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/actions/permissions/workflow`),
    githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/properties/values`),
    githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/code-security-configuration`),
  ]);

  await observeResult(env, "github.avkroken.repositories.effective_rulesets", rulesets);

  let normalizedRulesets: Record<string, unknown>[] = [];
  if (rulesets.available) {
    normalizedRulesets = await mapLimit(rulesets.value, 3, async (summary) => {
      const id = integer(summary.id);
      if (!id) return normalizeRuleset(summary, retrievedAt);
      const detail = await githubOptionalJson<UnknownRecord>(env, `/repos/${encodedRepo}/rulesets/${id}`);
      return normalizeRuleset(detail.available ? detail.value : summary, retrievedAt);
    });
  }

  const security = securityConfiguration.available
    ? {
      ...section(securityConfiguration),
      value: {
        status: text(securityConfiguration.value.status),
        configuration: normalizeSecurityConfiguration(securityConfiguration.value.configuration),
      },
    }
    : section(securityConfiguration);

  return {
    schemaVersion: 1,
    generatedAt: retrievedAt,
    organization: org,
    repository: repoName,
    effectiveGovernance: {
      rulesets: rulesets.available
        ? {
          status: "available",
          direct: normalizedRulesets.filter((item) => record(item.provenance)?.direct === true),
          inherited: normalizedRulesets.filter((item) => record(item.provenance)?.inherited === true),
          effective: normalizedRulesets,
          truncated: rulesets.truncated,
        }
        : section(rulesets),
      actions: {
        permissions: section(actions),
        selectedActions: section(selectedActions),
        workflowPermissions: section(workflowPermissions),
        workflowExecutionProtections: {
          status: "permission_denied",
          permissionState: "blocked_by_read_only_policy",
          reason: "GitHub requires repository Administration: write to list effective Actions policies. No write permission is requested.",
        },
      },
      customProperties: properties.available
        ? {
          ...section(properties),
          value: array(properties.value.properties).map((propertyValue) => {
            const item = record(propertyValue) ?? {};
            return { property: text(item.property_name), value: safeObject(item.value), derived: false };
          }),
        }
        : section(properties),
      securityConfiguration: security,
      customPropertyRulesetRelations: {
        status: "not_exposed_by_provider",
        reason: "The read-only effective repository ruleset response identifies inherited rulesets, but organization rule targeting conditions require the organization ruleset endpoint, whose GET requires Administration: write.",
      },
    },
  };
}
