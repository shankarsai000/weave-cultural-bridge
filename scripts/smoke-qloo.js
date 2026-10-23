// Live Qloo smoke test (Gate A). Run once your hackathon key is in .env:
//   node --env-file=.env scripts/smoke-qloo.js
// Records status, latency, counts and field NAMES only. Never prints the key. Response samples are written to
// .private/fixtures/ (git-ignored) because Qloo data must not go into a public repository.
import { mkdir, writeFile } from "node:fs/promises";
import { createRestAdapter, HACKATHON_BASE_URL } from "../src/rest.js";

const log = [];
const adapter = createRestAdapter({ onCall: (c) => log.push(c), timeoutMs: 20000 });
const report = { baseUrl: process.env.QLOO_BASE_URL || HACKATHON_BASE_URL, keyPresent: Boolean(process.env.QLOO_API_KEY), steps: [] };

async function step(name, fn) {
  const t = Date.now();
  try {
    const value = await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t, summary: summarize(value) });
    return value;
  } catch (err) {
    report.steps.push({ name, ok: false, ms: Date.now() - t, code: err.code ?? "ERROR", message: err.message });
    return null;
  }
}
const summarize = (v) =>
  Array.isArray(v)
    ? { count: v.length, first: v[0] ? { id: v[0].id, name: v[0].name, fields: Object.keys(v[0]), tagCount: v[0].tags?.length ?? 0 } : null }
    : v;

const a = await step("search artist: Radiohead", () => adapter.searchEntities({ query: "Radiohead", entityType: "urn:entity:artist", limit: 3 }));
const b = await step("search artist: Hans Zimmer", () => adapter.searchEntities({ query: "Hans Zimmer", entityType: "urn:entity:artist", limit: 3 }));
const seeds = [a?.[0]?.id, b?.[0]?.id].filter(Boolean);
let insights = null;
if (seeds.length) {
  insights = await step("insights artist from seeds", () =>
    adapter.getRecommendations({ entityType: "urn:entity:artist", seedEntityIds: seeds, limit: 10 }),
  );
  await step("insights movie from same seeds (cross-domain)", () =>
    adapter.getRecommendations({ entityType: "urn:entity:movie", seedEntityIds: seeds, limit: 5 }),
  );
}
await step("tags search: anime", () => adapter.searchTags({ query: "anime", limit: 5 }));
await step("unsupported type is blocked locally", () =>
  adapter.getRecommendations({ entityType: "urn:entity:music", seedEntityIds: ["x"] }),
);

report.calls = log;
console.log(JSON.stringify(report, null, 2));
if (insights) {
  await mkdir(".private/fixtures", { recursive: true });
  await writeFile(".private/fixtures/insights-artist.json", JSON.stringify(insights, null, 2));
  console.log("Saved normalized sample to .private/fixtures/ (git-ignored).");
}
process.exitCode = report.steps.filter((s) => s.name !== "unsupported type is blocked locally").every((s) => s.ok) ? 0 : 1;
