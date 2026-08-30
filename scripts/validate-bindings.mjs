import { readFile } from "node:fs/promises";
import ts from "typescript";

function parseJsonc(path, text) {
  const parsed = ts.parseConfigFileTextToJson(path, text);
  if (parsed.error) {
    const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n");
    throw new Error(`Could not parse ${path}: ${message}`);
  }
  return parsed.config ?? {};
}

function bindingNamesFromBlock(source, pattern, description) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${description}`);
  return [...match[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((entry) => entry[1]);
}

const configPath = "wrangler.jsonc";
const config = parseJsonc(configPath, await readFile(configPath, "utf8"));
const entrypoint = String(config.main ?? "").trim();
if (!entrypoint) throw new Error(`${configPath} is missing main Worker entrypoint`);

const source = await readFile(entrypoint, "utf8");
const sharedEnvPath = "src/env.ts";
const sharedEnvSource = await readFile(sharedEnvPath, "utf8");
const sharedNames = bindingNamesFromBlock(
  sharedEnvSource,
  /interface\s+SkvallerbyttanBindings\s*\{([\s\S]*?)\n\}/,
  `interface SkvallerbyttanBindings in ${sharedEnvPath}`,
);
const workerNames = bindingNamesFromBlock(
  source,
  /type\s+Env\s*=\s*SkvallerbyttanBindings\s*&\s*\{([\s\S]*?)\n\};/,
  `Env extension in ${entrypoint}`,
);
const envNames = [...new Set([...sharedNames, ...workerNames])].sort();
const configuredNames = [
  ...Object.keys(config.vars ?? {}),
  ...(config.secrets?.required ?? []),
  ...(config.send_email ?? []).map((binding) => binding.name),
  ...(config.durable_objects?.bindings ?? []).map((binding) => binding.name),
].sort();

const expected = [...new Set(configuredNames)].sort();
const missing = envNames.filter((name) => !expected.includes(name));
const unused = expected.filter((name) => !envNames.includes(name));
const durableObjectClasses = [...new Set((config.durable_objects?.bindings ?? []).map((binding) => binding.class_name).filter(Boolean))];
const missingExports = durableObjectClasses.filter((className) => !new RegExp(`export\\s+class\\s+${className}\\b`).test(source));

if (missing.length || unused.length || missingExports.length) {
  console.error("Cloudflare binding contract mismatch.");
  if (missing.length) console.error(`Missing from ${configPath}: ${missing.join(", ")}`);
  if (unused.length) console.error(`Configured but absent from Env: ${unused.join(", ")}`);
  if (missingExports.length) console.error(`Durable Object classes not exported by ${entrypoint}: ${missingExports.join(", ")}`);
  process.exit(1);
}

console.log(`Validated ${envNames.length} Worker bindings from ${sharedEnvPath} + ${entrypoint}: ${envNames.join(", ")}`);
if (durableObjectClasses.length) console.log(`Validated Durable Object exports: ${durableObjectClasses.join(", ")}`);
