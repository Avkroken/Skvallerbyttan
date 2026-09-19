import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/observations.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("dashboard exposes five accessible top-level tabs and matching panels", () => {
  for (const tab of ["overview", "github", "cloudflare", "activity", "insight"]) {
    assert.match(html, new RegExp(`id="tab-${tab}"[^>]*role="tab"`));
    assert.match(html, new RegExp(`id="panel-${tab}"[^>]*role="tabpanel"`));
    assert.match(html, new RegExp(`aria-controls="panel-${tab}"`));
  }
  assert.match(html, /role="tablist"/);
});

test("tab navigation supports keyboard movement, deep links and lazy canonical reads", () => {
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /Home/);
  assert.match(app, /End/);
  assert.match(app, /URLSearchParams/);
  assert.match(app, /\/api\/v1\/capabilities/);
  assert.match(app, /\/api\/v1\/activity/);
  assert.match(app, /\/api\/v1\/github\/org\/state/);
  assert.match(app, /\/api\/v1\/cloudflare\/workers/);
});

test("mobile styles keep navigation and capability cards usable", () => {
  assert.match(css, /\.top-tabs\s*\{/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /\.capability-grid/);
  assert.match(css, /@media \(max-width: 680px\)/);
});
