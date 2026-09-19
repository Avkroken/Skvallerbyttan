import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import { recordReadTelemetry } from "../src/telemetry";

test("read telemetry preserves consumer and never writes identifiers for people", () => {
  const points: unknown[] = [];
  const env = {
    OBSERVABILITY: {
      writeDataPoint(point: unknown) {
        points.push(point);
      },
    },
  } as Env;

  recordReadTelemetry(env, {
    capability: "github.avkroken.organization.actions_permissions",
    provider: "github",
    consumer: "chatgpt",
    operation: "GET /api/v1/github/org/state",
    result: "ok",
    cache: "hit",
    durationMs: 12,
  });

  assert.equal(points.length, 1);
  assert.deepEqual(points[0], {
    indexes: ["github.avkroken.organization.actions_permissions"],
    blobs: ["github", "chatgpt", "GET /api/v1/github/org/state", "ok", "hit"],
    doubles: [1, 12],
  });
});
