import { readFile } from "node:fs/promises";

const source = await readFile("src/index.ts", "utf8");
const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));

const envMatch = source.match(/interface\s+Env\s*\{([\s\S]*?)\n\}/);
if (!envMatch) throw new Error("Could not find interface Env in src/index.ts");

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

if (missing.length || unused.length) {
  console.error("Cloudflare binding contract mismatch.");
  if (missing.length) console.error(`Missing from wrangler.jsonc: ${missing.join(", ")}`);
  if (unused.length) console.error(`Configured but absent from Env: ${unused.join(", ")}`);
  process.exit(1);
}

console.log(`Validated ${envNames.length} Worker bindings: ${envNames.join(", ")}`);
