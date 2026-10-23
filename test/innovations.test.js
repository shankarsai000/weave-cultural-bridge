import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import { runSynestheticAnalysis } from "../src/synesthesia.js";
import { buildAgentPersonas, simulateRehearsal } from "../src/rehearsal.js";
import { createDemoAdapter, DEMO_PRESET } from "../src/fixtures.js";
import { runAnalysis, buildPlan, validateBrief, validateCommunities } from "../src/core.js";

let server;
let base;
before(async () => {
  process.env.WEAVE_LOG = "off";
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }),
);

const post = (p, body) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("Synesthesia: cross-domain queries assemble 360° Sensory Triad (Sonic, Visual, Gastronomic)", async () => {
  const adapter = createDemoAdapter();
  const brief = validateBrief({ name: "Synesthesia Fest", durationMinutes: 120, budgetAmount: 30000, currency: "INR", capacity: 200 });
  const communities = validateCommunities(
    DEMO_PRESET.map((c) => ({ ...c, seeds: c.seedIds.map((id) => ({ id, name: id })) })),
    "demo",
  );

  const syn = await runSynestheticAnalysis({
    adapter,
    brief,
    communities,
    domains: ["sonic", "visual", "gastronomic"],
    takePerDomain: 4,
  });

  assert.ok(syn.resultsByDomain.sonic);
  assert.ok(syn.resultsByDomain.visual);
  assert.ok(syn.resultsByDomain.gastronomic);
  assert.ok(syn.calls > 0);
  assert.ok(syn.sensoryTriad);
});

test("Rehearsal: agent personas evaluate timeline, detect friction zones and calculate cultural waste avoided", async () => {
  const adapter = createDemoAdapter();
  const brief = validateBrief({ name: "Rehearsal Night", durationMinutes: 120, budgetAmount: 40000, currency: "INR", capacity: 300 });
  const communities = validateCommunities(
    DEMO_PRESET.map((c) => ({ ...c, seeds: c.seedIds.map((id) => ({ id, name: id })) })),
    "demo",
  );

  const analysis = await runAnalysis({ adapter, mode: "demo", brief, communities, targetEntityType: "urn:entity:artist" });
  const plan = buildPlan({ analysis, brief, selectedIds: analysis.recommendedIds });

  const personas = buildAgentPersonas(communities, analysis);
  assert.equal(personas.length, communities.length);
  assert.ok(personas[0].topTags.length > 0);

  const rehearsal = simulateRehearsal({ plan, analysis, personas });
  assert.ok(rehearsal.overallResonancePercent >= 0);
  assert.ok(rehearsal.commercialArbitrage.culturalWasteAvoided >= 0);
  assert.equal(rehearsal.segmentAudits.length, plan.segments.length);
  assert.equal(rehearsal.critiques.length, personas.length);
  assert.ok(rehearsal.critiques[0].critique.includes("satisfaction is"));
});

test("Room Pulse API: create room, simulate attendees, dynamic clustering updates pulse", async () => {
  const resRoom = await post("/api/rooms", { title: "Devpost Hackathon Room" });
  const room = await resRoom.json();
  assert.equal(resRoom.status, 201);
  assert.ok(room.id.startsWith("room-"));

  // Check GET room
  const getRes = await fetch(`${base}/api/rooms/${room.id}`);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.title, "Devpost Hackathon Room");

  // Simulate attendees
  const simRes = await post(`/api/rooms/${room.id}/simulate`, {});
  assert.equal(simRes.status, 200);
  const simBody = await simRes.json();
  assert.equal(simBody.success, true);
  assert.ok(simBody.attendeeCount >= 3);
});
