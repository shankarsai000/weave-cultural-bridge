import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Runs the real app bundle in Node with a stub DOM: search, confirm, exclude and validation all go through the UI code.
const listeners = { click: [], change: [], input: [], keydown: [] };
const app = { innerHTML: "" };
globalThis.document = { querySelector: () => app, addEventListener: (type, fn) => listeners[type]?.push(fn) };
const root = new URL("../", import.meta.url);
const [core, exporters, fixtures, ui] = await Promise.all(
  ["src/core.js", "src/exporters.js", "src/fixtures.js", "web/app.js"].map((f) => readFile(new URL(f, root), "utf8")),
);
await import(`data:text/javascript,${encodeURIComponent([core, exporters, fixtures, ui].join("\n;\n"))}`);

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const fire = (type, target) => listeners[type].forEach((fn) => fn({ target, preventDefault() {} }));
const click = (dataset) => fire("click", { closest: () => ({ dataset }) });
const change = (dataset, value) => fire("change", { dataset, value });
const pill = () => (app.innerHTML.includes('class="pill bad">Invalid') ? "Invalid" : app.innerHTML.includes('class="pill ok">Valid') ? "Valid" : "none");

test("demo UI: analysis, search, confirm seed, exclude candidate and budget validation all work", async () => {
  await tick(120);
  assert.ok(app.innerHTML.includes("Bridge map"));
  assert.equal(pill(), "Valid");
  fire("input", { dataset: { search: "anime-gaming" }, value: "Mountain" });
  click({ action: "search", c: "anime-gaming" });
  await tick();
  assert.ok(app.innerHTML.includes("Mountain Radio Folk"));
  click({ action: "confirm", c: "anime-gaming", id: "demo:e16" });
  await tick(120);
  assert.ok(app.innerHTML.includes("Mountain Radio Folk"));
  click({ action: "exclude", id: "demo:e04" });
  await tick(120);
  assert.equal(app.innerHTML.includes('data-id="demo:e04"'), false);
  change({ brief: "budgetAmount" }, "1000");
  assert.equal(pill(), "Invalid");
  change({ brief: "budgetAmount" }, "25000");
  assert.equal(pill(), "Valid");
});
