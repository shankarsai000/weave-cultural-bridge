#!/usr/bin/env node
// Test double for the qloo harness. Prints the envelopes the adapter expects. No network, no credential.
// FAKE_QLOO_MODE: ok (default) | auth | garbage
const mode = process.env.FAKE_QLOO_MODE ?? "ok";
const [, , , sub, ...rest] = process.argv; // argv: node, script, "api", subcommand, flags...
const flag = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = (obj) => process.stdout.write(JSON.stringify(obj));

if (mode === "auth") {
  out({ error: true, code: "AUTH_FAILED", message: "Welcome to Qloo CLI! Set your API key with: qloo config set api-key YOUR_KEY" });
  process.exitCode = 1;
} else if (mode === "garbage") {
  process.stdout.write("Welcome banner, not JSON");
} else if (sub === "search") {
  const q = flag("query") ?? "";
  out({ results: { entities: [{ entity_id: `ent-${q}`, name: `Match for ${q}`, type: "urn:entity:artist" }] } });
} else if (sub === "insights") {
  const seeds = (flag("signal-entities") ?? "").split(",");
  const entities = seeds[0].startsWith("entity-a")
    ? [
        { entity_id: seeds[0], name: "Seed echo" },
        { entity_id: "ent-shared", name: "Shared Artist", query: { affinity: 0.82 } },
        { entity_id: "ent-a-only", name: "Alpha only" },
      ]
    : [
        { entity_id: "ent-shared", name: "Shared Artist", query: { affinity: 0.7 } },
        { entity_id: seeds[0], name: "Seed echo" },
        { entity_id: "ent-b-only", name: "Beta only" },
      ];
  out({ results: { entities } });
} else {
  out({ error: true, code: "INVALID_PARAMETER", message: "unknown command" });
  process.exitCode = 1;
}
