import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../src/server.js";
import { createHarnessAdapter } from "../src/harness.js";

// The fake harness stands in for `qloo`, so the live path (argument building, envelope parsing, error mapping,
// seed exclusion, export) runs end to end with no credential and no network.
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-qloo.mjs");
process.env.QLOO_CLI = FAKE;
process.env.WEAVE_LOG = "off";

let server;
let base;
before(async () => {
  await chmod(FAKE, 0o755);
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(resolve);
}));

const post = (p, body) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const brief = { name: "Live test night", durationMinutes: 120, budgetAmount: 25000, currency: "INR", capacity: 250 };
const communities = [
  { id: "alpha", name: "Alpha", seeds: [{ id: "entity-a1", name: "A1" }, { id: "entity-a2", name: "A2" }] },
  { id: "beta", name: "Beta", seeds: [{ id: "entity-b1", name: "B1" }, { id: "entity-b2", name: "B2" }] },
];

test("harness search normalizes entities and labels them qloo-live", async () => {
  const items = await createHarnessAdapter().searchEntities({ query: "Lantern" });
  assert.equal(items[0].id, "ent-Lantern");
  assert.equal(items[0].source, "qloo-live");
});

test("live analysis: qloo-live provenance, bridge found, seeds excluded, calls counted, exports carry provenance", async () => {
  const res = await post("/api/analysis", { mode: "live", brief, communities });
  const a = await res.json();
  assert.equal(res.status, 200);
  assert.equal(a.provenance, "qloo-live");
  assert.equal(a.status, "complete");
  assert.equal(a.calls, 2);
  assert.equal(a.candidates.find((c) => c.id === "ent-shared").isBridge, true);
  assert.equal(a.candidates.some((c) => c.id.startsWith("entity-")), false);
  const plan = await (await post("/api/plans", { analysisId: a.analysisId, selectedCandidateIds: a.recommendedIds })).json();
  const md = await post("/api/export", { analysisId: a.analysisId, format: "md", brief, segments: plan.segments });
  assert.equal(md.status, 200);
  assert.match(md.headers.get("content-type"), /text\/markdown/);
  assert.match(await md.text(), /qloo-live/);
  const csv = await (await post("/api/export", { analysisId: a.analysisId, format: "csv", brief, segments: plan.segments })).text();
  assert.equal(csv.trim().split("\n").length, plan.segments.length + 1);
  const bad = await post("/api/export", { analysisId: a.analysisId, format: "pdf", brief, segments: plan.segments });
  assert.equal(bad.status, 400);
});

test("auth failure is reported per profile with a safe code and no upstream text", async () => {
  process.env.FAKE_QLOO_MODE = "auth";
  try {
    const a = await (await post("/api/analysis", { mode: "live", brief, communities })).json();
    assert.equal(a.status, "failed");
    assert.ok(a.communities.every((c) => c.errorCode === "QLOO_AUTH_FAILED"));
    assert.equal(JSON.stringify(a).includes("Welcome"), false);
  } finally {
    delete process.env.FAKE_QLOO_MODE;
  }
});

test("non-JSON harness output is a schema mismatch per profile, not a crash", async () => {
  process.env.FAKE_QLOO_MODE = "garbage";
  try {
    const a = await (await post("/api/analysis", { mode: "live", brief, communities })).json();
    assert.ok(a.communities.every((c) => c.errorCode === "QLOO_SCHEMA_MISMATCH"));
  } finally {
    delete process.env.FAKE_QLOO_MODE;
  }
});
