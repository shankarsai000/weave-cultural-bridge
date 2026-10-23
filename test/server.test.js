import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { createHarnessAdapter } from "../src/harness.js";

let server;
let base;
before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(resolve);
}));

const send = (path, body, method = "POST") =>
  fetch(base + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const demoBrief = { name: "Test night", durationMinutes: 120, budgetAmount: 25000, currency: "INR", capacity: 250 };
const demoCommunities = [
  { id: "anime-gaming", name: "Anime and gaming", seeds: [{ id: "demo:e01", name: "Neon Tide" }, { id: "demo:e03", name: "Pixel Mercury" }] },
  { id: "indie-folk", name: "Indie and folk", seeds: [{ id: "demo:e02", name: "Quiet Harbour Trio" }, { id: "demo:e05", name: "Night Tram Records" }] },
];

test("health reports status and never returns the credential", async () => {
  const res = await fetch(`${base}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "ok");
  if (process.env.QLOO_API_KEY) assert.ok(!JSON.stringify(body).includes(process.env.QLOO_API_KEY));
});

test("live mode rejects placeholder seed IDs with the safe error envelope", async () => {
  const res = await send("/api/analysis", {
    mode: "live",
    brief: demoBrief,
    communities: [
      { id: "a", name: "A", seeds: [{ id: "REPLACE_WITH_LIVE_QLOO_ID_1", name: "x" }, { id: "QLOO_ENTITY_UUID_2", name: "y" }] },
      { id: "b", name: "B", seeds: [{ id: "QLOO_ENTITY_UUID_3", name: "z" }, { id: "QLOO_ENTITY_UUID_4", name: "w" }] },
    ],
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, "VALIDATION_FAILED");
  assert.ok(body.error.requestId);
});

test("demo analysis, then plan, then PATCH re-validation", async () => {
  const analysis = await (await send("/api/analysis", { mode: "demo", brief: demoBrief, communities: demoCommunities })).json();
  assert.equal(analysis.provenance, "demo-fixture");
  const picks = analysis.candidates.filter((c) => c.isBridge).map((c) => c.id);
  assert.ok(picks.length >= 1);
  const created = await send("/api/plans", { analysisId: analysis.analysisId, selectedCandidateIds: picks });
  const plan = await created.json();
  assert.equal(created.status, 201);
  assert.equal(plan.validation.isValid, true, plan.validation.errors.join(" | "));
  const patched = await (await send(`/api/plans/${plan.planId}`, { budgetAmount: 1000 }, "PATCH")).json();
  assert.equal(patched.validation.isValid, false);
});

test("harness adapter reports QLOO_UNAVAILABLE when the CLI is missing", async () => {
  await assert.rejects(createHarnessAdapter({ bin: "/nonexistent/qloo-cli" }).searchEntities({ query: "radiohead" }), { code: "QLOO_UNAVAILABLE" });
});
