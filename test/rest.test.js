import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestAdapter, HACKATHON_BASE_URL } from "../src/rest.js";
import { computeTagBridges, runAnalysis, validateBrief, validateCommunities } from "../src/core.js";
import { createDemoAdapter, DEMO_PRESET } from "../src/fixtures.js";

// Fake fetch that records the request and returns a canned Qloo-shaped envelope. Not real Qloo data.
function fakeFetch(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const ENVELOPE = {
  results: {
    entities: [
      { entity_id: "E1", name: "One", type: "urn:entity", tags: [{ id: "urn:tag:genre:music:indie", name: "Indie", type: "urn:tag:genre" }] },
      { entity_id: "E2", name: "Two", tags: [] },
    ],
  },
};

test("REST insights: hackathon base URL, GET, X-Api-Key header, documented params only", async () => {
  const f = fakeFetch(200, ENVELOPE);
  const a = createRestAdapter({ apiKey: "k-test", fetchImpl: f });
  const out = await a.getRecommendations({ entityType: "urn:entity:artist", seedEntityIds: ["S1", "S2"], excludedEntityIds: ["X1"], limit: 10 });
  const { url, init } = f.calls[0];
  assert.equal(url.origin, HACKATHON_BASE_URL);
  assert.equal(url.pathname, "/v2/insights");
  assert.equal(init.method, "GET");
  assert.equal(init.headers["X-Api-Key"], "k-test");
  assert.equal(url.searchParams.get("filter.type"), "urn:entity:artist");
  assert.equal(url.searchParams.get("signal.interests.entities"), "S1,S2");
  assert.equal(url.searchParams.get("filter.exclude.entities"), "X1");
  assert.equal(url.search.includes("k-test"), false, "key never in the query string");
  assert.equal(out[0].source, "qloo-live");
  assert.equal(out[0].tags[0].name, "Indie");
});

test("REST rejects unsupported filter.type before spending quota", async () => {
  const f = fakeFetch(200, ENVELOPE);
  const a = createRestAdapter({ apiKey: "k", fetchImpl: f });
  await assert.rejects(a.getRecommendations({ entityType: "urn:entity:music", seedEntityIds: ["S1"] }), { code: "VALIDATION_FAILED" });
  assert.equal(f.calls.length, 0);
});

test("REST maps upstream statuses to safe codes and never calls without a key", async () => {
  for (const [status, code] of [[401, "QLOO_AUTH_FAILED"], [403, "QLOO_FORBIDDEN_TYPE"], [429, "QLOO_RATE_LIMITED"], [400, "QLOO_UNSUPPORTED_QUERY"], [502, "QLOO_UNAVAILABLE"]]) {
    const a = createRestAdapter({ apiKey: "k", fetchImpl: fakeFetch(status, {}) });
    await assert.rejects(a.searchEntities({ query: "x" }), { code });
  }
  const f = fakeFetch(200, ENVELOPE);
  await assert.rejects(createRestAdapter({ apiKey: "", fetchImpl: f }).searchEntities({ query: "x" }), { code: "QLOO_AUTH_FAILED" });
  assert.equal(f.calls.length, 0);
});

test("REST tag search uses /v2/tags", async () => {
  const f = fakeFetch(200, { results: { tags: [{ id: "urn:tag:keyword:anime", name: "Anime" }] } });
  const tags = await createRestAdapter({ apiKey: "k", fetchImpl: f }).searchTags({ query: "anime" });
  assert.equal(f.calls[0].url.pathname, "/v2/tags");
  assert.deepEqual(tags[0], { id: "urn:tag:keyword:anime", name: "Anime", type: undefined });
});

test("tag bridges: only tags seen in 2+ communities, prevalence is observed share", () => {
  const t = (id) => ({ id, name: id });
  const bridges = computeTagBridges({
    a: [{ id: "1", tags: [t("indie"), t("synth")] }, { id: "2", tags: [t("indie")] }],
    b: [{ id: "3", tags: [t("indie")] }, { id: "4", tags: [t("folk")] }],
  });
  assert.deepEqual(bridges.map((b) => b.id), ["indie"]);
  assert.equal(bridges[0].prevalence.a, 1);
  assert.equal(bridges[0].prevalence.b, 0.5);
  assert.equal(bridges[0].tagBridgeScore, 0.925);
});

test("demo analysis exposes tag bridges with demo provenance tags", async () => {
  const pool = createDemoAdapter();
  const communities = validateCommunities(
    DEMO_PRESET.map((c) => ({ ...c, seeds: c.seedIds.map((id) => ({ id, name: id })) })),
    "demo",
  );
  const brief = validateBrief({ name: "x", durationMinutes: 120, budgetAmount: 25000, currency: "INR", capacity: 100 });
  const a = await runAnalysis({ adapter: pool, mode: "demo", brief, communities, targetEntityType: "urn:entity:artist" });
  assert.ok(a.tagBridges.length > 0);
  assert.ok(a.tagBridges.every((b) => b.id.startsWith("demo-tag:") && b.communitiesCovered.length > 1));
});
