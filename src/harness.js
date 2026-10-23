// Live transport: the event's permitted surface, the official harness (`qloo api`). The harness reads the event
// credential from QLOO_API_KEY or `qloo setup`. The key is never a command-line argument, so it cannot reach argv,
// shell history or logs. execFile runs without a shell, and every value is validated before it becomes an argument.
import { execFile } from "node:child_process";
import { WeaveError, normalizeEntities } from "./core.js";

const SAFE_ID = /^[A-Za-z0-9:._-]{1,120}$/;
const MESSAGES = {
  QLOO_AUTH_FAILED: "Qloo credential is missing or was rejected",
  QLOO_RATE_LIMITED: "Qloo quota or rate limit reached; try again later",
  ENTITY_NOT_FOUND: "No Qloo entity matched",
  QLOO_UNSUPPORTED_QUERY: "Qloo rejected this query",
  QLOO_UNAVAILABLE: "Qloo is unavailable right now",
};
// Harness error codes are matched by pattern and mapped to safe codes. Upstream messages are never forwarded.
const RULES = [
  [/AUTH|FORBIDDEN|UNAUTH|API_?KEY/i, "QLOO_AUTH_FAILED", 401, false],
  [/RATE|QUOTA|LIMIT/i, "QLOO_RATE_LIMITED", 429, true],
  [/NOT_?FOUND|NO_?MATCH/i, "ENTITY_NOT_FOUND", 404, false],
  [/INVALID|UNSUPPORTED|PARAM|BAD_?REQUEST/i, "QLOO_UNSUPPORTED_QUERY", 422, false],
];

function fromHarnessError(code) {
  const hit = RULES.find(([re]) => re.test(String(code ?? "")));
  const [, mapped, status, retryable] = hit ?? [null, "QLOO_UNAVAILABLE", 503, true];
  return new WeaveError(status, mapped, MESSAGES[mapped], retryable);
}

function run(args, { bin, timeoutMs }) {
  const isScript = bin.endsWith(".mjs") || bin.endsWith(".js");
  const file = isScript ? process.execPath : bin;
  const execArgs = isScript ? [bin, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(file, execArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      let body = null;
      try {
        body = JSON.parse(String(stdout));
      } catch {
        body = null;
      }
      if (body && body.error) return reject(fromHarnessError(body.code));
      if (body === null) {
        return reject(
          err
            ? new WeaveError(503, "QLOO_UNAVAILABLE", MESSAGES.QLOO_UNAVAILABLE, true)
            : new WeaveError(502, "QLOO_SCHEMA_MISMATCH", "Qloo harness returned non-JSON output"),
        );
      }
      return resolve(body);
    });
  });
}

export function createHarnessAdapter({ bin = process.env.QLOO_CLI || "qloo", timeoutMs = 15000 } = {}) {
  const call = (args) => run(args, { bin, timeoutMs });
  return {
    async searchEntities({ query, entityType, limit = 10 } = {}) {
      if (typeof query !== "string" || !query.trim() || query.length > 100) {
        throw new WeaveError(400, "VALIDATION_FAILED", "query must be 1 to 100 characters");
      }
      const args = ["api", "search", `--query=${query.trim()}`, `--take=${Math.min(20, limit)}`, "--json"];
      if (entityType) {
        if (typeof entityType !== "string" || !SAFE_ID.test(entityType)) {
          throw new WeaveError(400, "VALIDATION_FAILED", "entityType is malformed");
        }
        args.push(`--type=${entityType}`);
      }
      return normalizeEntities(await call(args));
    },
    async getRecommendations({ entityType, seedEntityIds, limit = 10 }) {
      const ids = Array.isArray(seedEntityIds) ? seedEntityIds : [];
      if (typeof entityType !== "string" || !SAFE_ID.test(entityType) || !ids.length || !ids.every((id) => SAFE_ID.test(id))) {
        throw new WeaveError(400, "VALIDATION_FAILED", "entity type or seed IDs are malformed");
      }
      const args = [
        "api",
        "insights",
        `--type=${entityType}`,
        `--signal-entities=${ids.join(",")}`,
        `--take=${Math.min(20, limit)}`,
        "--json",
      ];
      return normalizeEntities(await call(args));
    },
  };
}
