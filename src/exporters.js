// Run-of-show and evidence exports. Pure, so the browser and the server produce identical files.
// Every export carries provenance, labels costs as assumptions, and holds no credentials.
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const mdCell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const moneyOf = (n, cur) => `${cur} ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function buildDocument({ analysis = null, plan }) {
  const provenance = analysis?.provenance ?? plan.provenance ?? "user-input";
  return {
    title: plan.brief.name,
    provenance,
    analysisStatus: analysis?.status ?? "none",
    brief: plan.brief,
    segments: plan.segments,
    validation: plan.validation,
    communities: (analysis?.communities ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      queryStatus: c.queryStatus,
      errorCode: c.errorCode ?? null,
      resultCount: c.resultCount,
    })),
    candidates: (analysis?.candidates ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      source: c.source,
      communitiesCovered: c.communitiesCovered,
      perCommunityRank: c.perCommunityRank,
      coverageRatio: c.coverageRatio,
      rankQualityMean: c.rankQualityMean,
      bridgeScore: c.bridgeScore,
    })),
    notes: [
      "bridgeScore is WEAVE's triage score from observed ranks. It is not a Qloo score or an attendance prediction.",
      "Costs marked 'assumption' are placeholders for the organizer to replace.",
      provenance === "qloo-live"
        ? "Live Qloo results, as returned by the harness at analysis time."
        : "Demo fixture data: not live Qloo results.",
    ],
  };
}

const toJson = (d) => JSON.stringify(d, null, 2);

function toMarkdown(d) {
  const cur = d.brief.currency;
  return [
    `# ${mdCell(d.title)}`,
    "",
    `Provenance: **${d.provenance}** · analysis status: ${d.analysisStatus}`,
    "",
    "## Run-of-show",
    "",
    "| Start | Min | Purpose | Segment | Cost | Cost kind | Evidence |",
    "|---|---|---|---|---|---|---|",
    ...d.segments.map(
      (s) =>
        `| ${clock(s.startMinute)} | ${s.durationMinutes} | ${mdCell(s.purpose)} | ${mdCell(s.title)} | ${moneyOf(s.estimatedCost, cur)} | ${s.costKind} | ${mdCell(s.evidenceRefs.join(", ") || "none")} |`,
    ),
    "",
    "## Validation",
    "",
    `- Valid: ${d.validation.isValid ? "yes" : "no"}`,
    `- Time: ${d.validation.totalMinutes} of ${d.validation.availableMinutes} min`,
    `- Budget: ${moneyOf(d.validation.budgetTotal, cur)} of ${moneyOf(d.validation.budgetCeiling, cur)} (estimates)`,
    ...d.validation.errors.map((e) => `- Error: ${mdCell(e)}`),
    ...d.validation.warnings.map((w) => `- Warning: ${mdCell(w)}`),
    "",
    "## Evidence",
    "",
    "| Candidate | Communities (rank) | Coverage | Triage score |",
    "|---|---|---|---|",
    ...d.candidates.map(
      (c) =>
        `| ${mdCell(c.name)} | ${mdCell(c.communitiesCovered.map((cid) => `${cid} #${c.perCommunityRank[cid]}`).join(", "))} | ${Math.round(c.coverageRatio * 100)}% | ${c.bridgeScore} |`,
    ),
    "",
    "## Notes",
    "",
    ...d.notes.map((n) => `- ${mdCell(n)}`),
    "",
  ].join("\n");
}

function toCsv(d) {
  const head = ["start_minute", "duration_minutes", "purpose", "title", "candidate_ids", "estimated_cost", "cost_kind", "evidence_refs", "provenance"];
  const rows = d.segments.map((s) => [
    s.startMinute,
    s.durationMinutes,
    s.purpose,
    s.title,
    s.candidateIds.join(";"),
    s.estimatedCost,
    s.costKind,
    s.evidenceRefs.join(";"),
    d.provenance,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

const FORMATS = {
  json: { type: "application/json; charset=utf-8", ext: "json", render: toJson },
  md: { type: "text/markdown; charset=utf-8", ext: "md", render: toMarkdown },
  csv: { type: "text/csv; charset=utf-8", ext: "csv", render: toCsv },
};

export function renderExport(format, doc) {
  const f = FORMATS[format];
  if (!f) throw new Error(`unknown export format: ${format}`);
  return { body: f.render(doc), type: f.type, ext: f.ext };
}
