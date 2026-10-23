// Live transport: direct REST to the hackathon base URL documented in the Qloo Agentic Hackathon Developer Guide.
// Hackathon keys only work against https://hackathon.api.qloo.com (production/staging return 401).
// Rules from the guide that this file enforces:
//   - every call is GET with parameters in the query string (never a JSON body);
//   - the key travels only in the X-Api-Key header (never a query param or Bearer token);
//   - /v2/insights always carries filter.type from the supported list;
//   - unsupported parameters are silently ignored upstream, so we only send documented ones.
// The key is read from the server environment, never logged, never returned to the browser.
import { WeaveError, normalizeEntities } from "./core.js";

export const HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";
export const INSIGHT_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:video_game",
];
const SAFE_ID = /^[A-Za-z0-9:._-]{1,120}$/;

const MESSAGES = {
  QLOO_AUTH_FAILED: "Qloo credential is missing or was rejected (check the hackathon base URL and X-Api-Key)",
  QLOO_FORBIDDEN_TYPE: "This entity type is not enabled for the hackathon key",
  QLOO_RATE_LIMITED: "Qloo quota or rate limit reached; try again later",
  QLOO_UNSUPPORTED_QUERY: "Qloo rejected this query",
  QLOO_UNAVAILABLE: "Qloo is unavailable right now",
  QLOO_SCHEMA_MISMATCH: "Qloo returned an unexpected response",
};

export function mapStatus(status) {
  if (status === 401) return new WeaveError(401, "QLOO_AUTH_FAILED", MESSAGES.QLOO_AUTH_FAILED, false);
  if (status === 403) return new WeaveError(403, "QLOO_FORBIDDEN_TYPE", MESSAGES.QLOO_FORBIDDEN_TYPE, false);
  if (status === 429) return new WeaveError(429, "QLOO_RATE_LIMITED", MESSAGES.QLOO_RATE_LIMITED, true);
  if (status === 400 || status === 404 || status === 422) {
    return new WeaveError(422, "QLOO_UNSUPPORTED_QUERY", MESSAGES.QLOO_UNSUPPORTED_QUERY, false);
  }
  return new WeaveError(503, "QLOO_UNAVAILABLE", MESSAGES.QLOO_UNAVAILABLE, status >= 500);
}

function checkIds(ids, name) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 25 || !ids.every((id) => typeof id === "string" && SAFE_ID.test(id))) {
    throw new WeaveError(400, "VALIDATION_FAILED", `${name} are malformed`);
  }
}

export function createRestAdapter({
  baseUrl = process.env.QLOO_BASE_URL || HACKATHON_BASE_URL,
  apiKey = process.env.QLOO_API_KEY,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
  onCall = null,
} = {}) {
  async function get(pathname, params) {
    if (!apiKey) throw new WeaveError(401, "QLOO_AUTH_FAILED", "QLOO_API_KEY is not set on the server", false);
    const url = new URL(pathname, baseUrl);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WeaveError(503, "QLOO_UNAVAILABLE", MESSAGES.QLOO_UNAVAILABLE, true);
    }
    onCall?.({ path: pathname, status: res.status, ms: Date.now() - started });
    if (!res.ok) throw mapStatus(res.status);
    try {
      return await res.json();
    } catch {
      throw new WeaveError(502, "QLOO_SCHEMA_MISMATCH", MESSAGES.QLOO_SCHEMA_MISMATCH);
    }
  }

  return {
    transport: "rest",
    async searchEntities({ query, entityType, limit = 10 } = {}) {
      if (typeof query !== "string" || !query.trim() || query.length > 100) {
        throw new WeaveError(400, "VALIDATION_FAILED", "query must be 1 to 100 characters");
      }
      if (entityType !== undefined && (typeof entityType !== "string" || !SAFE_ID.test(entityType))) {
        throw new WeaveError(400, "VALIDATION_FAILED", "entityType is malformed");
      }
      const body = await get("/search", { query: query.trim(), types: entityType, take: Math.min(20, limit) });
      return normalizeEntities(body);
    },

    async getRecommendations({ entityType, seedEntityIds, excludedEntityIds = [], limit = 10 } = {}) {
      if (!INSIGHT_TYPES.includes(entityType)) {
        throw new WeaveError(400, "VALIDATION_FAILED", `filter.type must be one of the supported hackathon types`);
      }
      checkIds(seedEntityIds, "seed IDs");
      const exclude = excludedEntityIds.filter((id) => typeof id === "string" && SAFE_ID.test(id)).slice(0, 50);
      const body = await get("/v2/insights", {
        "filter.type": entityType,
        "signal.interests.entities": seedEntityIds.join(","),
        // Documented filter; WEAVE also removes seeds/exclusions locally in case it is ignored.
        "filter.exclude.entities": exclude.length ? exclude.join(",") : undefined,
        take: Math.min(25, limit),
      });
      return normalizeEntities(body);
    },

    async searchTags({ query, limit = 10 } = {}) {
      if (typeof query !== "string" || !query.trim() || query.length > 100) {
        throw new WeaveError(400, "VALIDATION_FAILED", "query must be 1 to 100 characters");
      }
      const body = await get("/v2/tags", { "filter.query": query.trim(), take: Math.min(20, limit) });
      const r = body?.results;
      const list = Array.isArray(r) ? r : Array.isArray(r?.tags) ? r.tags : null;
      if (!list) throw new WeaveError(502, "QLOO_SCHEMA_MISMATCH", MESSAGES.QLOO_SCHEMA_MISMATCH);
      return list
        .map((t) => ({ id: t?.id ?? t?.tag_id, name: t?.name, type: t?.type ?? t?.subtype }))
        .filter((t) => typeof t.id === "string" && typeof t.name === "string");
    },
  };
}
