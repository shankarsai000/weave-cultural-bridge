import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/core.js";
import { createDemoAdapter, DEMO_POOL, DEMO_PRESET, DEMO_TARGET } from "../src/fixtures.js";

const ent = (id) => ({ id, name: id, source: "qloo-live", upstream: {} });
const brief = (over = {}) =>
  core.validateBrief({ name: "Test night", durationMinutes: 120, budgetAmount: 25000, currency: "INR", capacity: 250, ...over });

test("bridge score follows the documented formula", () => {
  const lists = {
    A: [ent("x"), ent("b"), ent("p1"), ent("p2"), ent("c")],
    B: [ent("x"), ent("q1"), ent("q2"), ent("q3"), ent("c")],
  };
  const s = Object.fromEntries(core.scoreCandidates(lists).map((c) => [c.id, c]));
  assert.ok(Math.abs(s.x.bridgeScore - 1) < 1e-9); // coverage 1, rank 1 in both lists
  assert.ok(Math.abs(s.c.bridgeScore - 0.7) < 1e-9); // coverage 1, last rank in both lists
  assert.ok(Math.abs(s.b.bridgeScore - (0.7 * 0.5 + 0.3 * 0.75)) < 1e-9); // coverage 0.5, rank 2 of 5 in one list
  assert.ok(s.x.bridgeScore > s.c.bridgeScore && s.c.bridgeScore > s.b.bridgeScore);
});

test("seeds and exclusions never become candidates; duplicates keep their first rank", () => {
  const lists = { A: [ent("seed"), ent("y"), ent("y"), ent("z")], B: [ent("out"), ent("y")] };
  const scored = core.scoreCandidates(lists, new Set(["seed", "out"]));
  assert.deepEqual(scored.map((c) => c.id).sort(), ["y", "z"]);
  assert.equal(scored.find((c) => c.id === "y").perCommunityRank.A, 2);
});

test("disjoint result lists produce no bridge", () => {
  const scored = core.scoreCandidates({ A: [ent("a1"), ent("a2")], B: [ent("b1")] });
  assert.equal(scored.some((c) => c.isBridge), false);
});

test("portfolio picks bridges first and keeps every community represented", () => {
  const lists = { A: [ent("b1"), ent("a1"), ent("a2")], B: [ent("b1"), ent("b2")], C: [ent("c1")] };
  const scored = core.scoreCandidates(lists);
  const ids = core.selectPortfolio(scored, ["A", "B", "C"], 4);
  assert.equal(ids[0], "b1");
  for (const cid of ["A", "B", "C"]) {
    assert.ok(ids.some((id) => scored.find((c) => c.id === id).perCommunityRank[cid] !== undefined), `${cid} represented`);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test("validator reports overruns, budget overflow, excluded entities and missing stages", () => {
  const analysis = {
    analysisId: "t",
    provenance: "demo-fixture",
    status: "complete",
    communities: [{ id: "A", name: "Alpha", queryStatus: "success", resultCount: 2 }],
  };
  const plan = core.finalize({
    analysis,
    brief: brief({ durationMinutes: 60, budgetAmount: 1000, excludedEntityIds: ["bad"] }),
    segments: [
      { id: "s1", title: "Bridge: bad", purpose: "bridge", durationMinutes: 40, estimatedCost: 800, costKind: "assumption", candidateIds: ["bad"], communityIds: [], evidenceRefs: [] },
      { id: "s2", title: "Break", purpose: "break", durationMinutes: 30, estimatedCost: 500, costKind: "assumption", candidateIds: [], communityIds: [], evidenceRefs: [] },
    ],
  });
  const msg = plan.validation.errors.join(" | ");
  assert.equal(plan.validation.isValid, false);
  assert.match(msg, /programme runs 70 min/);
  assert.match(msg, /exceeds the 1000/);
  assert.match(msg, /excluded entity bad/);
  assert.match(msg, /missing required stage: no selected anchor covers Alpha/);
});

test("demo pipeline: bridges appear, the plan validates, budget and duration edits are caught, repair explains itself", async () => {
  const communities = core.validateCommunities(
    DEMO_PRESET.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priority: p.priority,
      seeds: p.seedIds.map((id) => ({ id, name: DEMO_POOL.find((e) => e.id === id).name })),
    })),
    "demo",
  );
  const b = brief();
  const analysis = await core.runAnalysis({
    adapter: createDemoAdapter(),
    mode: "demo",
    brief: b,
    communities,
    targetEntityType: DEMO_TARGET,
    analysisId: "t1",
  });
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.provenance, "demo-fixture");
  assert.ok(analysis.candidates.some((c) => c.isBridge));
  const plan = core.buildPlan({ analysis, brief: b, selectedIds: analysis.recommendedIds });
  assert.equal(plan.validation.isValid, true, plan.validation.errors.join(" | "));
  assert.equal(core.patchPlan({ plan, analysis, patch: { budgetAmount: 17000 } }).validation.isValid, false);
  const fixed = core.patchPlan({ plan, analysis, patch: { durationMinutes: 60, repair: true } });
  assert.equal(fixed.validation.isValid, true, fixed.validation.errors.join(" | "));
  assert.ok(fixed.changes.length >= 1);
});

test("normalizeEntities accepts both documented envelopes and rejects malformed payloads", () => {
  const a = core.normalizeEntities({ results: { entities: [{ entity_id: "e1", name: "One", query: { affinity: 0.9 } }] } });
  assert.equal(a[0].id, "e1");
  assert.equal(a[0].source, "qloo-live");
  assert.equal(a[0].upstream.affinity, 0.9);
  assert.equal(core.normalizeEntities({ results: [{ id: "e2", name: "Two" }] })[0].id, "e2");
  assert.throws(() => core.normalizeEntities({ results: "oops" }), { code: "QLOO_SCHEMA_MISMATCH" });
  assert.throws(() => core.normalizeEntities({ results: { entities: [{ name: "No id" }] } }), { code: "QLOO_SCHEMA_MISMATCH" });
});

test("live mode rejects placeholder seeds and demo provenance", () => {
  const seeds = [{ id: "REPLACE_WITH_ID", name: "x" }, { id: "real-id-1", name: "y", provenance: "demo-fixture" }];
  assert.throws(() => core.validateCommunities([{ id: "a", name: "A", seeds }, { id: "b", name: "B", seeds }], "live"), { code: "VALIDATION_FAILED" });
});
