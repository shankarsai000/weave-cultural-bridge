// WEAVE core. Pure and dependency-free, so one copy runs in Node (server, tests) and in the browser build.
// Owns request validation, Qloo result normalization, bridge scoring, portfolio selection, plan compilation
// and deterministic validation. No LLM math lives here.

export const LIMITS = {
  communities: [2, 4],
  seeds: [2, 5],
  selected: [1, 10],
  segments: 20,
  duration: [30, 480],
  maxSegment: [5, 60],
  budget: [0, 10000000],
  capacity: [1, 10000],
};
export const CURRENCIES = ["INR", "USD"];
export const NOVELTY = ["balanced", "familiar-first", "adventurous"];
export const RECOMMENDED = 6;
// Placeholder estimates. Every output labels them as assumptions; organizers replace them with their own figures.
export const COST_ASSUMPTIONS = { recognition: 1500, bridge: 2500, "co-creation": 3000, break: 500 };

export class WeaveError extends Error {
  constructor(status, code, message, retryable = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const fail = (message) => {
  throw new WeaveError(400, "VALIDATION_FAILED", message);
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const round4 = (n) => Math.round(n * 10000) / 10000;
const sumBy = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const byIdAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function text(v, name, max, required = true) {
  if (v === undefined || v === null || v === "") {
    if (required) fail(`${name} is required`);
    return "";
  }
  if (typeof v !== "string") fail(`${name} must be text`);
  const t = v.trim();
  if (required && !t) fail(`${name} is required`);
  if (t.length > max) fail(`${name} must be at most ${max} characters`);
  return t;
}

function num(v, name, [min, max]) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    fail(`${name} must be a number from ${min} to ${max}`);
  }
  return v;
}

function int(v, name, range) {
  if (!Number.isInteger(v)) fail(`${name} must be a whole number`);
  return num(v, name, range);
}

function choice(v, name, allowed) {
  if (!allowed.includes(v)) fail(`${name} must be one of: ${allowed.join(", ")}`);
  return v;
}

export function validateBrief(b) {
  if (!isObj(b)) fail("brief must be an object");
  const excluded = b.excludedEntityIds ?? [];
  const notes = b.accessibilityNotes ?? [];
  if (!Array.isArray(excluded) || excluded.length > 50) fail("excludedEntityIds must be a list of up to 50 IDs");
  if (!Array.isArray(notes) || notes.length > 10) fail("accessibilityNotes must be a list of up to 10 notes");
  return {
    name: text(b.name, "brief.name", 100),
    locationLabel: text(b.locationLabel, "brief.locationLabel", 120, false),
    durationMinutes: int(b.durationMinutes, "brief.durationMinutes", LIMITS.duration),
    maxSegmentMinutes: int(b.maxSegmentMinutes ?? 30, "brief.maxSegmentMinutes", LIMITS.maxSegment),
    budgetAmount: num(b.budgetAmount, "brief.budgetAmount", LIMITS.budget),
    currency: choice(b.currency, "brief.currency", CURRENCIES),
    capacity: int(b.capacity, "brief.capacity", LIMITS.capacity),
    noveltyMode: choice(b.noveltyMode ?? "balanced", "brief.noveltyMode", NOVELTY),
    excludedEntityIds: excluded.map((id) => text(id, "excludedEntityIds[]", 120)),
    accessibilityNotes: notes.map((n) => text(n, "accessibilityNotes[]", 200)),
  };
}

// In live mode, seeds must be confirmed Qloo IDs. Placeholder IDs and demo provenance are rejected.
export function validateCommunities(list, mode = "demo") {
  if (!Array.isArray(list) || list.length < LIMITS.communities[0] || list.length > LIMITS.communities[1]) {
    fail("communities must contain 2 to 4 profiles");
  }
  const provenance = mode === "live" ? "qloo-live" : "demo-fixture";
  const seen = new Set();
  return list.map((c) => {
    if (!isObj(c)) fail("each community must be an object");
    const id = text(c.id, "community.id", 64);
    if (seen.has(id)) fail(`duplicate community id: ${id}`);
    seen.add(id);
    if (!Array.isArray(c.seeds) || c.seeds.length < LIMITS.seeds[0] || c.seeds.length > LIMITS.seeds[1]) {
      fail(`community ${id} needs 2 to 5 seeds`);
    }
    const seeds = c.seeds.map((s) => {
      if (!isObj(s)) fail("each seed must be an object");
      const sid = text(s.id, "seed.id", 120);
      if (mode === "live" && /placeholder|replace|example|QLOO_ENTITY/i.test(sid)) {
        fail(`seed ${sid} looks like a placeholder; use a confirmed Qloo ID`);
      }
      if (s.provenance !== undefined && s.provenance !== provenance) {
        fail(`seed ${sid} must have provenance ${provenance} in ${mode} mode`);
      }
      return { id: sid, name: text(s.name, "seed.name", 120), provenance };
    });
    return {
      id,
      name: text(c.name, "community.name", 120),
      description: text(c.description, "community.description", 1000, false),
      priority: int(c.priority ?? 2, "community.priority", [1, 3]),
      seeds,
    };
  });
}

// Accepts the envelopes the harness reads: results.entities[] (insights) or results[] / results.entities[] (search).
// Upstream affinity and popularity are kept as upstream values only. They are never used in WEAVE's score.
export function normalizeEntities(payload) {
  const r = payload?.results;
  const list = Array.isArray(r) ? r : Array.isArray(r?.entities) ? r.entities : null;
  if (!list) throw new WeaveError(502, "QLOO_SCHEMA_MISMATCH", "Qloo response contained no entity list");
  return list.map((e) => {
    const id = e?.entity_id ?? e?.id;
    if (typeof id !== "string" || !id || typeof e.name !== "string" || !e.name) {
      throw new WeaveError(502, "QLOO_SCHEMA_MISMATCH", "Qloo entity is missing an id or a name");
    }
    const upstream = {};
    const affinity = e.affinity ?? e.query?.affinity;
    if (typeof affinity === "number") upstream.affinity = affinity;
    if (typeof e.popularity === "number") upstream.popularity = e.popularity;
    return { id, name: e.name, type: typeof e.type === "string" ? e.type : undefined, source: "qloo-live", upstream };
  });
}

// communityLists: { [communityId]: entity[] } in upstream order (index 0 = rank 1).
// Seeds and exclusions never become candidates. A duplicate keeps its first rank.
// bridgeScore = 0.70 * coverage + 0.30 * rankQualityMean, with rankQuality = 1 - (rank - 1) / max(K - 1, 1).
export function scoreCandidates(communityLists, excluded = new Set()) {
  const ids = Object.keys(communityLists);
  const rows = new Map();
  for (const cid of ids) {
    const list = communityLists[cid];
    list.forEach((e, i) => {
      if (excluded.has(e.id)) return;
      const row = rows.get(e.id) ?? { id: e.id, name: e.name, source: e.source, upstream: e.upstream ?? {}, ranks: {}, quality: {} };
      if (row.ranks[cid] !== undefined) return;
      row.ranks[cid] = i + 1;
      row.quality[cid] = 1 - i / Math.max(list.length - 1, 1);
      rows.set(e.id, row);
    });
  }
  return [...rows.values()]
    .map((row) => {
      const covered = ids.filter((c) => row.ranks[c] !== undefined);
      const coverageRatio = covered.length / ids.length;
      const rankQualityMean = sumBy(covered, (c) => row.quality[c]) / covered.length;
      return {
        id: row.id,
        name: row.name,
        source: row.source,
        upstream: row.upstream,
        perCommunityRank: row.ranks,
        communitiesCovered: covered,
        isBridge: covered.length > 1,
        coverageRatio,
        rankQualityMean,
        bridgeScore: 0.7 * coverageRatio + 0.3 * rankQualityMean,
        evidenceRefs: covered.map((c) => `qloo-result:${c}:${row.ranks[c]}`),
      };
    })
    .sort(
      (a, b) =>
        b.bridgeScore - a.bridgeScore ||
        b.coverageRatio - a.coverageRatio ||
        b.rankQualityMean - a.rankQualityMean ||
        byIdAsc(a.id, b.id),
    );
}

// Two passes: bridges first (capped so every community keeps a slot), then one anchor for each uncovered community.
export function selectPortfolio(scored, communityIds, maxSelected) {
  const picked = [];
  const taken = new Set();
  const add = (c) => {
    picked.push(c);
    taken.add(c.id);
  };
  const bridgeCap = Math.max(0, maxSelected - communityIds.length);
  for (const c of scored) {
    if (c.isBridge && picked.filter((p) => p.isBridge).length < bridgeCap) add(c);
  }
  for (const cid of communityIds) {
    if (picked.some((p) => p.perCommunityRank[cid] !== undefined)) continue;
    const own = scored
      .filter((c) => !taken.has(c.id) && c.perCommunityRank[cid] !== undefined)
      .sort((a, b) => a.perCommunityRank[cid] - b.perCommunityRank[cid])[0];
    if (own) add(own);
  }
  for (const c of scored) {
    if (picked.length < maxSelected && !taken.has(c.id)) add(c);
  }
  return picked.map((c) => c.id);
}

// Runs one comparable query per community. A failed community is isolated and reported, never replaced.
export async function runAnalysis({ adapter, mode, brief, communities, targetEntityType, take = 10, analysisId }) {
  const seedIds = communities.flatMap((c) => c.seeds.map((s) => s.id));
  const excluded = new Set([...seedIds, ...brief.excludedEntityIds]);
  const explored = [];
  let calls = 0;
  for (const c of communities) {
    try {
      calls += 1;
      const entities = await adapter.getRecommendations({
        entityType: targetEntityType,
        seedEntityIds: c.seeds.map((s) => s.id),
        excludedEntityIds: [...excluded],
        limit: take,
      });
      explored.push({ c, entities, error: null });
    } catch (err) {
      explored.push({
        c,
        entities: null,
        error: { code: err?.code ?? "QLOO_UNAVAILABLE", retryable: Boolean(err?.retryable) },
      });
    }
  }
  const ok = explored.filter((e) => e.entities);
  if (mode === "live" && ok.some((e) => e.entities.some((x) => x.source !== "qloo-live"))) {
    throw new WeaveError(500, "PROVENANCE_MISMATCH", "live analysis received non-live entities");
  }
  const lists = Object.fromEntries(ok.map((e) => [e.c.id, e.entities]));
  const successIds = ok.map((e) => e.c.id);
  const candidates = scoreCandidates(lists, excluded);
  const status = ok.length === explored.length ? "complete" : ok.length ? "partial" : "failed";
  const warnings = [];
  if (status !== "complete") {
    warnings.push("Partial analysis: failed profiles are left out of coverage. Do not read this as a full comparison.");
  }
  if (!candidates.some((c) => c.isBridge)) {
    warnings.push("No candidate was returned for more than one community in this query set. No bridge was invented.");
  }
  return {
    analysisId,
    mode,
    provenance: mode === "live" ? "qloo-live" : "demo-fixture",
    status,
    targetEntityType,
    take,
    calls,
    communities: explored.map((e) => ({
      id: e.c.id,
      name: e.c.name,
      queryStatus: e.entities ? "success" : "failed",
      ...(e.error ? { errorCode: e.error.code, retryable: e.error.retryable } : {}),
      resultCount: e.entities ? e.entities.length : 0,
      results: (e.entities ?? []).map((x, i) => ({
        entityId: x.id,
        name: x.name,
        rank: i + 1,
        source: x.source,
        upstream: x.upstream,
      })),
    })),
    candidates: candidates.map((c) => ({
      ...c,
      coverageRatio: round4(c.coverageRatio),
      rankQualityMean: round4(c.rankQualityMean),
      bridgeScore: round4(c.bridgeScore),
    })),
    recommendedIds: selectPortfolio(candidates, successIds, RECOMMENDED),
    scoring: {
      formula: "bridgeScore = 0.70 * coverage + 0.30 * rankQualityMean",
      coverageBasis: successIds.length,
      note: "WEAVE triage score from observed ranks. Not a Qloo score or an attendance prediction.",
    },
    warnings,
    trace: [
      { step: "resolve-seeds", status: "complete" },
      { step: "qloo-exploration", status },
      { step: "bridge-ranking", status: "complete" },
    ],
  };
}

const layout = (segments) => {
  let t = 0;
  return segments.map((s) => {
    const out = { ...s, startMinute: t };
    t += Number.isFinite(s.durationMinutes) ? s.durationMinutes : 0;
    return out;
  });
};

// Compiles selected candidates into a run-of-show: bridges first, then recognition anchors, a break, and a co-creation close.
export function buildPlan({ analysis, brief, selectedIds, costOverrides = {} }) {
  if (!Array.isArray(selectedIds) || selectedIds.length < LIMITS.selected[0] || selectedIds.length > LIMITS.selected[1]) {
    fail("select 1 to 10 candidates");
  }
  const byId = new Map(analysis.candidates.map((c) => [c.id, c]));
  const picks = [...new Set(selectedIds)].map((id) => {
    const c = byId.get(id);
    if (!c) throw new WeaveError(422, "UNKNOWN_CANDIDATE", `candidate ${id} is not part of this analysis`);
    return c;
  });
  const steps = [
    ...picks.filter((c) => c.isBridge).map((c) => ({ purpose: "bridge", candidate: c })),
    ...picks.filter((c) => !c.isBridge).map((c) => ({ purpose: "recognition", candidate: c })),
  ];
  steps.push({ purpose: "co-creation", candidate: null });
  if (steps.length >= 4) steps.splice(Math.floor(steps.length / 2), 0, { purpose: "break", candidate: null });
  const per = Math.min(brief.maxSegmentMinutes, Math.floor(brief.durationMinutes / steps.length));
  const segments = steps.map((s, i) => {
    const id = `seg-${i + 1}`;
    const overridden = costOverrides[id] !== undefined;
    let title = "Co-creation (organizer-designed)";
    if (s.candidate) title = `${s.purpose === "bridge" ? "Bridge" : "Recognition"}: ${s.candidate.name}`;
    else if (s.purpose === "break") title = "Break";
    return {
      id,
      title,
      purpose: s.purpose,
      durationMinutes: per,
      estimatedCost: overridden ? Number(costOverrides[id]) : COST_ASSUMPTIONS[s.purpose],
      costKind: overridden ? "user-entered" : "assumption",
      candidateIds: s.candidate ? [s.candidate.id] : [],
      communityIds: s.candidate ? s.candidate.communitiesCovered : [],
      evidenceRefs: s.candidate ? s.candidate.evidenceRefs : [],
    };
  });
  return finalize({ analysis, brief, segments });
}

// Deterministic validation. Every hard rule lives here; prose from an LLM never overrides it.
export function finalize({ analysis = null, brief, segments }) {
  const laid = layout(segments);
  const errors = [];
  const warnings = [];
  if (laid.length > LIMITS.segments) errors.push(`plan has ${laid.length} segments; the maximum is ${LIMITS.segments}`);
  for (const s of laid) {
    if (!Number.isInteger(s.durationMinutes) || s.durationMinutes <= 0) {
      errors.push(`${s.title}: duration must be a positive whole number of minutes`);
    } else if (s.durationMinutes > brief.maxSegmentMinutes) {
      errors.push(`${s.title}: ${s.durationMinutes} min exceeds the ${brief.maxSegmentMinutes} min segment limit`);
    }
    if (!Number.isFinite(s.estimatedCost) || s.estimatedCost < 0) {
      errors.push(`${s.title}: cost must be a non-negative number`);
    }
    if ((s.purpose === "bridge" || s.purpose === "recognition") && s.candidateIds.length === 0) {
      errors.push(`${s.title}: Qloo-backed segment has no candidate`);
    }
  }
  const totalMinutes = sumBy(laid, (s) => (Number.isFinite(s.durationMinutes) ? s.durationMinutes : 0));
  const budgetTotal = sumBy(laid, (s) => (Number.isFinite(s.estimatedCost) ? s.estimatedCost : 0));
  if (totalMinutes > brief.durationMinutes) {
    errors.push(`programme runs ${totalMinutes} min; the event has ${brief.durationMinutes} min`);
  }
  if (budgetTotal > brief.budgetAmount) {
    errors.push(`estimated cost ${budgetTotal} ${brief.currency} exceeds the ${brief.budgetAmount} ${brief.currency} ceiling`);
  }
  const excluded = new Set(brief.excludedEntityIds);
  for (const s of laid) {
    for (const id of s.candidateIds) {
      if (excluded.has(id)) errors.push(`excluded entity ${id} is used in ${s.title}`);
    }
  }
  if (analysis) {
    for (const c of analysis.communities) {
      if (c.queryStatus !== "success") {
        warnings.push(`${c.name}: query ${c.queryStatus}; this profile contributes no evidence`);
      } else if (c.resultCount === 0) {
        warnings.push(`${c.name}: no candidates returned; explain the coverage gap to the organizer`);
      } else if (!laid.some((s) => s.communityIds.includes(c.id))) {
        errors.push(`missing required stage: no selected anchor covers ${c.name}`);
      }
    }
    if (analysis.status !== "complete") warnings.push("Analysis is partial.");
    if (analysis.provenance === "demo-fixture") warnings.push("Demo fixture data: not live Qloo results.");
  }
  return {
    analysisId: analysis?.analysisId ?? null,
    provenance: analysis?.provenance ?? "user-input",
    brief,
    segments: laid,
    validation: {
      isValid: errors.length === 0,
      totalMinutes,
      availableMinutes: brief.durationMinutes,
      budgetTotal,
      budgetCeiling: brief.budgetAmount,
      currency: brief.currency,
      errors,
      warnings,
    },
  };
}

// Deterministic repair suggestions: shorten segments to fit the clock, then drop the optional break to fit the budget.
export function repairPlan({ segments, brief }) {
  const changes = [];
  let out = segments.map((s) => ({ ...s }));
  const minutes = sumBy(out, (s) => (Number.isFinite(s.durationMinutes) ? s.durationMinutes : 0));
  if (minutes > brief.durationMinutes) {
    const per = Math.max(1, Math.floor(brief.durationMinutes / out.length));
    out = out.map((s) => ({ ...s, durationMinutes: Math.min(s.durationMinutes, per) }));
    changes.push(`Shortened segments to at most ${per} min so the programme fits ${brief.durationMinutes} min.`);
  }
  const cost = sumBy(out, (s) => (Number.isFinite(s.estimatedCost) ? s.estimatedCost : 0));
  if (cost > brief.budgetAmount && out.some((s) => s.purpose === "break")) {
    out = out.filter((s) => s.purpose !== "break");
    changes.push("Removed the optional break to reduce estimated cost.");
  }
  return { segments: out, changes };
}

// Applies a user edit (brief limits, per-segment minutes or cost, optional repair) and re-validates everything.
export function patchPlan({ plan, analysis = null, patch }) {
  if (!isObj(patch)) fail("patch must be an object");
  const brief = validateBrief({ ...plan.brief, ...pick(patch, ["durationMinutes", "budgetAmount", "maxSegmentMinutes"]) });
  let segments = plan.segments.map((s) => ({ ...s }));
  for (const sp of Array.isArray(patch.segments) ? patch.segments : []) {
    const seg = segments.find((s) => s.id === sp?.id);
    if (!seg || !isObj(sp)) fail(`unknown segment ${sp?.id}`);
    if (sp.durationMinutes !== undefined) seg.durationMinutes = sp.durationMinutes;
    if (sp.estimatedCost !== undefined) {
      seg.estimatedCost = sp.estimatedCost;
      seg.costKind = "user-entered";
    }
  }
  let changes = [];
  if (patch.repair === true) ({ segments, changes } = repairPlan({ segments, brief }));
  return { ...finalize({ analysis, brief, segments }), changes };
}
