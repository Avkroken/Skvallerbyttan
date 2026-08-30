import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const entrypoint = String(config.main ?? "").trim();
if (!entrypoint) throw new Error("wrangler.jsonc is missing main Worker entrypoint");

const source = await readFile(entrypoint, "utf8");
const envMatch = source.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
if (!envMatch) throw new Error(`Could not find interface Env in ${entrypoint}`);

const envNames = [...envMatch[1].matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map((match) => match[1]).sort();
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
  if (missing.length) console.error(`Missing from wrangler.jsonc: ${missing.join(", ")}`);
  if (unused.length) console.error(`Configured but absent from Env: ${unused.join(", ")}`);
  if (missingExports.length) console.error(`Durable Object classes not exported by ${entrypoint}: ${missingExports.join(", ")}`);
  process.exit(1);
}

console.log(`Validated ${envNames.length} Worker bindings from ${entrypoint}: ${envNames.join(", ")}`);
if (durableObjectClasses.length) console.log(`Validated Durable Object exports: ${durableObjectClasses.join(", ")}`);
