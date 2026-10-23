// WEAVE HTTP server. node:http with zero dependencies. Thin routes over core.js; the demo UI is served from /.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./core.js";
import { createDemoAdapter, DEMO_TARGET } from "./fixtures.js";
import { createHarnessAdapter } from "./harness.js";
import { createRestAdapter, HACKATHON_BASE_URL } from "./rest.js";
import { buildDocument, renderExport } from "./exporters.js";

const VERSION = "0.2.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BODY = 64 * 1024;
const analyses = new Map();
const plans = new Map();

// Per-client analysis limiter. It protects the Qloo quota from accidental or hostile bursts.
const hits = new Map();
const PER_MINUTE = Number(process.env.WEAVE_ANALYSES_PER_MINUTE) || 30;
function allowAnalysis(req) {
  const key = req.socket.remoteAddress ?? "local";
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60000);
  if (recent.length >= PER_MINUTE) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Client-supplied segments are reduced to known fields before validation and export.
const PURPOSES = ["recognition", "bridge", "co-creation", "break"];
function sanitizeSegment(s) {
  if (!s || typeof s !== "object" || !PURPOSES.includes(s.purpose)) {
    throw new core.WeaveError(400, "VALIDATION_FAILED", "each segment needs a valid purpose");
  }
  const strings = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === "string").slice(0, 20) : []);
  return {
    id: String(s.id ?? "").slice(0, 40),
    title: String(s.title ?? "").slice(0, 200),
    purpose: s.purpose,
    durationMinutes: Number(s.durationMinutes),
    estimatedCost: Number(s.estimatedCost),
    costKind: s.costKind === "user-entered" ? "user-entered" : "assumption",
    candidateIds: strings(s.candidateIds),
    communityIds: strings(s.communityIds),
    evidenceRefs: strings(s.evidenceRefs),
  };
}

// Bounded in-memory store: the oldest entry is evicted first.
function remember(map, id, value) {
  if (map.size >= 50) map.delete(map.keys().next().value);
  map.set(id, value);
}
const defaultMode = () => (process.env.WEAVE_DEFAULT_MODE === "live" ? "live" : "demo");
function resolveMode(v) {
  const mode = v ?? defaultMode();
  if (mode !== "demo" && mode !== "live") throw new core.WeaveError(400, "VALIDATION_FAILED", "mode must be demo or live");
  return mode;
}
const transport = () => (process.env.QLOO_TRANSPORT === "harness" ? "harness" : "rest");
const timeoutMs = () => Number(process.env.QLOO_TIMEOUT_MS) || 15000;
const adapterFor = (mode) => {
  if (mode !== "live") return createDemoAdapter();
  return transport() === "harness" ? createHarnessAdapter({ timeoutMs: timeoutMs() }) : createRestAdapter({ timeoutMs: timeoutMs() });
};

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new core.WeaveError(413, "PAYLOAD_TOO_LARGE", "request body is larger than 64 KB");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    value = undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new core.WeaveError(400, "VALIDATION_FAILED", "body must be a JSON object");
  }
  return value;
}

async function handle(req, res, url) {
  const p = url.pathname;
  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    const html = await readFile(path.join(ROOT, "public", "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    return res.end(html);
  }
  if (req.method === "GET" && p === "/api/health") {
    return send(res, 200, {
      status: "ok",
      version: VERSION,
      defaultMode: defaultMode(),
      liveTransport: transport() === "harness" ? "qloo harness (qloo api)" : `rest ${process.env.QLOO_BASE_URL || HACKATHON_BASE_URL}`,
      qlooKeyInEnv: Boolean(process.env.QLOO_API_KEY),
    });
  }
  if (req.method === "GET" && p === "/api/tags/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q || q.length > 100) throw new core.WeaveError(400, "VALIDATION_FAILED", "q must be 1 to 100 characters");
    const adapter = adapterFor("live");
    if (!adapter.searchTags) throw new core.WeaveError(501, "NOT_SUPPORTED", "tag search needs the REST transport");
    return send(res, 200, { items: await adapter.searchTags({ query: q, limit: 10 }), provenance: "qloo-live" });
  }
  if (req.method === "GET" && p === "/api/entities/search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q || q.length > 100) throw new core.WeaveError(400, "VALIDATION_FAILED", "q must be 1 to 100 characters");
    const mode = resolveMode(url.searchParams.get("mode") ?? undefined);
    const items = await adapterFor(mode).searchEntities({
      query: q,
      entityType: url.searchParams.get("type") ?? DEMO_TARGET,
      limit: 10,
    });
    return send(res, 200, { items, provenance: mode === "live" ? "qloo-live" : "demo-fixture" });
  }
  if (req.method === "POST" && p === "/api/analysis") {
    if (!allowAnalysis(req)) {
      throw new core.WeaveError(429, "RATE_LIMITED", "Too many analyses in the last minute. Wait a moment and try again.", true);
    }
    const body = await readJson(req);
    const mode = resolveMode(body.mode);
    const brief = core.validateBrief(body.brief);
    const communities = core.validateCommunities(body.communities, mode);
    const targetEntityType = body.targetEntityType ?? DEMO_TARGET;
    if (typeof targetEntityType !== "string" || !/^urn:entity:[a-z_]{2,40}$/.test(targetEntityType)) {
      throw new core.WeaveError(400, "VALIDATION_FAILED", "targetEntityType must look like urn:entity:artist");
    }
    const analysisId = randomUUID();
    const analysis = await core.runAnalysis({
      adapter: adapterFor(mode),
      mode,
      brief,
      communities,
      targetEntityType,
      analysisId,
    });
    remember(analyses, analysisId, { analysis, brief });
    return send(res, 200, analysis);
  }
  if (req.method === "POST" && p === "/api/plans") {
    const body = await readJson(req);
    const stored = analyses.get(String(body.analysisId));
    if (!stored) throw new core.WeaveError(404, "ANALYSIS_NOT_FOUND", "analysis not found or expired; run it again");
    const plan = core.buildPlan({
      analysis: stored.analysis,
      brief: body.brief ? core.validateBrief(body.brief) : stored.brief,
      selectedIds: body.selectedCandidateIds,
      costOverrides: body.costOverrides ?? {},
    });
    const planId = randomUUID();
    const full = { planId, ...plan };
    remember(plans, planId, { analysis: stored.analysis, plan: full });
    return send(res, 201, full);
  }
  const planMatch = p.match(/^\/api\/plans\/([0-9a-f-]{36})$/);
  if (req.method === "PATCH" && planMatch) {
    const stored = plans.get(planMatch[1]);
    if (!stored) throw new core.WeaveError(404, "PLAN_NOT_FOUND", "plan not found or expired");
    const body = await readJson(req);
    const next = core.patchPlan({ plan: stored.plan, analysis: stored.analysis, patch: body });
    stored.plan = { planId: planMatch[1], ...next };
    return send(res, 200, stored.plan);
  }
  if (req.method === "POST" && p === "/api/export") {
    const body = await readJson(req);
    const stored = analyses.get(String(body.analysisId));
    if (!stored) throw new core.WeaveError(404, "ANALYSIS_NOT_FOUND", "analysis not found or expired; run it again");
    const format = body.format ?? "json";
    if (!["json", "md", "csv"].includes(format)) {
      throw new core.WeaveError(400, "VALIDATION_FAILED", "format must be json, md or csv");
    }
    if (!Array.isArray(body.segments) || body.segments.length === 0 || body.segments.length > core.LIMITS.segments) {
      throw new core.WeaveError(400, "VALIDATION_FAILED", "segments must be a non-empty list");
    }
    const brief = core.validateBrief(body.brief ?? stored.brief);
    const plan = core.finalize({ analysis: stored.analysis, brief, segments: body.segments.map(sanitizeSegment) });
    const out = renderExport(format, buildDocument({ analysis: stored.analysis, plan }));
    res.writeHead(200, {
      "content-type": out.type,
      "content-disposition": `attachment; filename="weave-run-of-show.${out.ext}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    return res.end(out.body);
  }
  if (req.method === "POST" && p === "/api/feedback") {
    const body = await readJson(req);
    if (typeof body.useful !== "boolean") throw new core.WeaveError(400, "VALIDATION_FAILED", "useful must be true or false");
    return send(res, 202, { accepted: true, stored: false });
  }
  throw new core.WeaveError(404, "NOT_FOUND", "no such route");
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const requestId = randomUUID().slice(0, 8);
    const started = Date.now();
    res.on("finish", () => {
      if (process.env.WEAVE_LOG !== "off") {
        const route = new URL(req.url ?? "/", "http://localhost").pathname;
        console.log(JSON.stringify({ requestId, method: req.method, route, status: res.statusCode, ms: Date.now() - started }));
      }
    });
    try {
      await handle(req, res, new URL(req.url ?? "/", "http://localhost"));
    } catch (err) {
      const known = err instanceof core.WeaveError;
      if (!known) console.error(`[${requestId}] unexpected ${err?.name ?? "error"}`);
      if (res.headersSent) return res.end();
      send(res, known ? err.status : 500, {
        error: {
          code: known ? err.code : "INTERNAL",
          message: known ? err.message : "Unexpected server error",
          requestId,
          retryable: known && Boolean(err.retryable),
        },
      });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`WEAVE ${VERSION} on http://localhost:${port} (default mode: ${defaultMode()})`);
  });
}
