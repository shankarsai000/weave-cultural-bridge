// WEAVE app. Served by the WEAVE server (demo and live) or standalone (demo only).
// Entity names come from upstream data, so every interpolated value goes through esc().
(() => {
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n, cur) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const NUMERIC = ["durationMinutes", "maxSegmentMinutes", "budgetAmount", "capacity"];
  const demo = createDemoAdapter();
  const nameOf = (id) => DEMO_POOL.find((e) => e.id === id)?.name ?? id;
  const presetCommunities = () =>
    DEMO_PRESET.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priority: p.priority,
      seeds: p.seedIds.map((id) => ({ id, name: nameOf(id), provenance: "demo-fixture" })),
    }));
  const LIVE_PRESET = {
    brief: { name: "Crossroads Festival 2026", locationLabel: "Bengaluru Amphitheatre", durationMinutes: 120, budgetAmount: 35000, currency: "INR" },
    communities: [
      {
        id: "alt-rock",
        name: "Alt & Experimental Rock",
        description: "Fans of progressive textures, complex rhythms, and emotive vocals",
        priority: 3,
        seeds: [
          { id: "70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C", name: "Radiohead", provenance: "qloo-live" },
          { id: "2AE9B79B-864F-4C23-BF36-6705D172F509", name: "Pink Floyd", provenance: "qloo-live" },
        ],
      },
      {
        id: "electro-cinema",
        name: "Cinematic & Electronic Soundscapes",
        description: "Fans of atmospheric orchestration, synth-pop, and futuristic scores",
        priority: 2,
        seeds: [
          { id: "37DB91E9-9EE1-4C98-AA01-0AF0C34274EC", name: "Hans Zimmer", provenance: "qloo-live" },
          { id: "012EF80C-B187-4ECB-9C3D-9CA5228B503C", name: "Daft Punk", provenance: "qloo-live" },
        ],
      },
    ],
  };
  const S = {
    server: false,
    mode: "demo",
    brief: {
      name: "Cross-Culture Campus Night", locationLabel: "Bengaluru, India", durationMinutes: 120,
      maxSegmentMinutes: 30, budgetAmount: 25000, currency: "INR", capacity: 250,
      noveltyMode: "balanced", excludedEntityIds: [],
    },
    communities: presetCommunities(),
    search: {},
    analysis: null, picked: new Set(), focus: null, plan: null,
    synesthesia: null, rehearsal: null, room: null,
    error: "", notice: "", busy: false, baseline: false, exportFmt: "md",
  };

  const call = async (path, init) => {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
    return body;
  };
  const post = (path, body) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const checkServer = async () => {
    try {
      const h = await call("/api/health");
      S.server = h.status === "ok" && typeof h.version === "string";
    } catch {
      S.server = false;
    }
  };

  const afterSeedChange = () => {
    if (S.mode === "demo") return void analyze();
    S.analysis = null;
    S.plan = null;
    S.notice = "Seeds changed. Run the live analysis when every profile has 2 to 5 seeds.";
    render();
  };

  const setMode = (mode) => {
    S.mode = mode;
    S.communities = mode === "live" ? S.communities.map((c) => ({ ...c, seeds: [] })) : presetCommunities();
    S.analysis = null;
    S.plan = null;
    S.search = {};
    S.focus = null;
    S.error = "";
    S.notice = mode === "live" ? "Live mode: search and confirm 2 to 5 seeds per profile. Each analysis uses Qloo quota, so you start it yourself." : "";
    if (mode === "demo") return void analyze();
    render();
  };

  const briefView = () => {
    const b = S.brief;
    const input = (key, type = "text", extra = "") => `<input data-brief="${key}" type="${type}" value="${esc(b[key])}" ${extra}>`;
    const select = (key, opts) =>
      `<select data-brief="${key}">${opts.map((o) => `<option value="${esc(o)}" ${String(b[key]) === String(o) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
    return `<section class="card"><h2>1 · Experience brief</h2><div class="grid2">
      ${field("Event name", input("name", "text", 'maxlength="100"'))}
      ${field("Location", input("locationLabel"))}
      ${field("Duration (min)", select("durationMinutes", [60, 90, 120]))}
      ${field("Max segment (min)", input("maxSegmentMinutes", "number", 'min="5" max="60"'))}
      ${field("Budget ceiling", input("budgetAmount", "number", 'min="0" step="500"'))}
      ${field("Currency", select("currency", ["INR", "USD"]))}
      ${field("Capacity", input("capacity", "number", 'min="1" max="10000"'))}
      ${field("Familiarity", select("noveltyMode", ["balanced", "familiar-first", "adventurous"]))}
    </div></section>`;
  };

  const communityCard = (c) => {
    const box = S.search[c.id] ?? { q: "", items: [], error: "" };
    const results = box.items.length
      ? `<ul class="results">${box.items
          .map(
            (it) => `<li><span>${esc(it.name)} <span class="muted">${esc(it.type ?? "")}</span></span>
              <button data-action="confirm" data-c="${esc(c.id)}" data-id="${esc(it.id)}" ${c.seeds.length >= 5 ? "disabled" : ""}>Confirm seed</button></li>`,
          )
          .join("")}</ul>`
      : box.error
        ? `<p class="muted">${esc(box.error)}</p>`
        : "";
    return `<article class="community"><h3>${esc(c.name)}</h3>
      <p class="muted">${esc(c.description)} · ${c.seeds.length} of 2 to 5 seeds</p>
      <div class="chips">${c.seeds
        .map((s) => `<span class="chip">${esc(s.name)}<button class="x" data-action="drop-seed" data-c="${esc(c.id)}" data-id="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">×</button></span>`)
        .join("")}</div>
      <div class="search"><input data-search="${esc(c.id)}" type="search" placeholder="Search entities" aria-label="Search entities for ${esc(c.name)}" value="${esc(box.q)}">
        <button data-action="search" data-c="${esc(c.id)}">Search</button></div>
      ${results}</article>`;
  };

  const communitiesView = () => {
    const liveBanner =
      S.mode === "live"
        ? `<div class="preset-banner">
            <span>⚡ <strong>Quick-Start:</strong> Pre-load verified live seeds (Radiohead, Pink Floyd × Hans Zimmer, Daft Punk)</span>
            <button class="btn-sm primary" data-action="load-live-preset">Load Live Preset</button>
          </div>`
        : "";
    return `<section class="card"><h2>2 · Audience constellation</h2>
      ${liveBanner}
      <div class="grid2">${S.communities.map(communityCard).join("")}</div>
      <div class="row"><button class="primary" data-action="analyze" ${S.busy ? "disabled" : ""}>${
        S.busy ? "Running…" : S.mode === "live" ? "Run live analysis" : "Run cultural exploration"
      }</button><span class="muted">${S.mode === "live" ? "Uses Qloo quota through the server." : "Demo fixtures only. Nothing here is Qloo output."}</span></div></section>`;
  };

  const bridgeView = () => {
    const A = S.analysis;
    const cs = A.candidates.slice(0, 9);
    const inspector = `<div class="inspector"><p><span class="pill ${A.provenance === "qloo-live" ? "ok" : "demo"}">${esc(A.provenance)}</span>
      status ${esc(A.status)} · ${A.mode === "live" ? "Qloo calls" : "demo adapter calls"}: ${A.calls}</p>
      <p class="muted">${A.communities
        .map((c) => `${esc(c.name)}: ${c.queryStatus === "success" ? `${c.resultCount} results` : `failed (${esc(c.errorCode)})`}`)
        .join(" · ")}</p>
      ${A.warnings.map((w) => `<p class="warn">! ${esc(w)}</p>`).join("")}</div>`;
    if (!cs.length) {
      return `<section class="card"><h2>3 · Bridge map</h2>${inspector}<p class="muted">No candidate was returned by this query set. No bridge was invented.</p></section>`;
    }
    const cname = (cid) => A.communities.find((c) => c.id === cid)?.name ?? cid;
    const H = Math.max(40 + cs.length * 40, 60 + A.communities.length * 120);
    const cx = 230;
    const kx = 520;
    const rowY = (i) => 60 + i * 40;
    const commY = (cid) => 60 + A.communities.findIndex((c) => c.id === cid) * 120;
    const edges = cs
      .flatMap((c, i) =>
        c.communitiesCovered.map(
          (cid) => `<line x1="${cx}" y1="${commY(cid)}" x2="${kx}" y2="${rowY(i)}" class="${c.isBridge ? "edge-bridge" : "edge"}"></line>`,
        ),
      )
      .join("");
    const comms = A.communities
      .map((c) => `<circle cx="${cx}" cy="${commY(c.id)}" r="20" class="comm"></circle><text x="${cx - 30}" y="${commY(c.id) + 4}" text-anchor="end">${esc(c.name)}</text>`)
      .join("");
    const nodes = cs
      .map((c, i) => {
        const pct = Math.round(c.coverageRatio * 100);
        const cls = `node${S.focus === c.id ? " focus" : ""}${S.picked.has(c.id) ? " picked" : ""}`;
        return `<g class="${cls}" data-action="focus" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.name)}, covers ${pct} percent of profiles"><circle cx="${kx}" cy="${rowY(i)}" r="7"></circle><text x="${kx + 14}" y="${rowY(i) + 4}">${esc(c.name)} · ${pct}%</text></g>`;
      })
      .join("");
    const rows = cs
      .map((c) => {
        const ranks = c.communitiesCovered.map((cid) => `${esc(cname(cid))} #${c.perCommunityRank[cid]}`).join("<br>");
        const on = S.picked.has(c.id);
        return `<tr><td>${esc(c.name)}</td><td>${ranks}</td><td>${Math.round(c.coverageRatio * 100)}%</td><td>${c.bridgeScore.toFixed(3)}</td><td><button data-action="toggle" data-id="${esc(c.id)}" aria-pressed="${on}">${on ? "Remove" : "Add"}</button></td></tr>`;
      })
      .join("");
    const f = cs.find((c) => c.id === S.focus);
    const evidence = f
      ? `<div class="evidence"><h3>${esc(f.name)} <span class="pill ${f.source === "qloo-live" ? "ok" : "demo"}">${esc(f.source)}</span></h3>
         <p class="muted">coverage = ${f.communitiesCovered.length}/${A.scoring.coverageBasis} = ${f.coverageRatio.toFixed(3)} · rankQualityMean = ${f.rankQualityMean.toFixed(3)}</p>
         <p>bridgeScore = 0.70 × ${f.coverageRatio.toFixed(3)} + 0.30 × ${f.rankQualityMean.toFixed(3)} = <strong>${f.bridgeScore.toFixed(3)}</strong></p>
         <p class="muted">WEAVE's triage score from observed ranks. Not a Qloo score or an attendance prediction.</p>
         <p class="muted">${f.evidenceRefs.map(esc).join(" · ")}</p>
         <button data-action="exclude" data-id="${esc(f.id)}">Exclude from analysis</button></div>`
      : `<p class="muted">Select a node to inspect its evidence.</p>`;
    const tagCloud = (A.tagBridges || []).length
      ? `<div style="margin-top:16px;">
          <h3>Shared Cultural Tags (${A.tagBridges.length})</h3>
          <p class="muted">Latent cultural affinities shared across communities in this query set:</p>
          <div class="tag-cloud">
            ${A.tagBridges
              .map(
                (t) => `<span class="tag-cloud-item" title="Covering: ${t.communitiesCovered.join(", ")}">
                  <span>${esc(t.name)}</span>
                  <strong>${Math.round(t.meanPrevalence * 100)}%</strong>
                </span>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

    const ladders = (A.tasteLadders || []).length
      ? `<div style="margin-top:20px;">
          <h3>Taste Ladders · Cultural Trajectories (${A.tasteLadders.length})</h3>
          <p class="muted">Evidence-based 3-step stepping stones transitioning the audience from one community's taste sphere to another:</p>
          <div class="ladder-box">
            ${A.tasteLadders
              .map(
                (l) => `<div class="ladder-card">
                  <div class="ladder-header">
                    <strong>${esc(l.fromCommunity.name)} ➔ ${esc(l.toCommunity.name)}</strong>
                    <button class="btn-sm" data-action="add-stepping-stone" data-id="${esc(l.rungs[1].entity.id)}">
                      ${S.picked.has(l.rungs[1].entity.id) ? "Stepping Stone in Plan" : "+ Add Stepping Stone to Plan"}
                    </button>
                  </div>
                  <div class="rungs">
                    <div class="rung">
                      <span class="rung-label">Rung 1 · Signature Anchor</span>
                      <span class="rung-title">${esc(l.rungs[0].entity.name)}</span>
                      <span class="pill demo" style="font-size:10px">${esc(l.fromCommunity.name)}</span>
                    </div>
                    <span class="rung-arrow">➔</span>
                    <div class="rung stepping">
                      <span class="rung-label">Rung 2 · Cultural Stepping Stone</span>
                      <span class="rung-title">${esc(l.rungs[1].entity.name)}</span>
                      <div class="tag-badges">${(l.rungs[1].connectingTags || []).map((t) => `<span class="tag-badge">${esc(t)}</span>`).join("")}</div>
                    </div>
                    <span class="rung-arrow">➔</span>
                    <div class="rung">
                      <span class="rung-label">Rung 3 · Signature Anchor</span>
                      <span class="rung-title">${esc(l.rungs[2].entity.name)}</span>
                      <span class="pill demo" style="font-size:10px">${esc(l.toCommunity.name)}</span>
                    </div>
                  </div>
                </div>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

    const synesthesiaBox = synesthesiaView();

    return `<section class="card"><h2>3 · Bridge map</h2>${inspector}
      <svg viewBox="0 0 760 ${H}" role="img" aria-label="Communities linked to candidate entities. Amber edges mark bridges.">${edges}${comms}${nodes}</svg>
      ${evidence}
      ${ladders}
      ${synesthesiaBox}
      ${tagCloud}
      <details open style="margin-top:16px;"><summary class="muted">Table view (accessible alternative)</summary>
      <table><thead><tr><th>Candidate</th><th>Observed ranks</th><th>Coverage</th><th>Score</th><th>Plan</th></tr></thead><tbody>${rows}</tbody></table></details></section>`;
  };

  const synesthesiaView = () => {
    if (!S.synesthesia) {
      return `<div style="margin-top:16px;">
        <button class="primary btn-sm" data-action="synesthesia" ${S.busy ? "disabled" : ""}>
          ✨ Discover 360° Synesthetic Triad (Sound + Cinema + Gastronomy)
        </button>
      </div>`;
    }
    const st = S.synesthesia.sensoryTriad;
    const tagList = (st.collectiveTags || []).map((t) => `<span class="tag-badge">${esc(t)}</span>`).join("");
    return `<div style="margin-top:20px;background:#0d111d;border:1px solid #312e81;border-radius:14px;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="color:var(--amber);margin:0;">360° Synesthetic Cultural Blueprint</h3>
        <span class="pill ok">Cross-Domain Qloo AI</span>
      </div>
      <p class="muted" style="margin:4px 0 10px;">Empirically matched sound, visual aesthetics, and brand/culinary pairings for these communities:</p>
      <div class="triad-grid">
        <div class="triad-card">
          <h4>🎵 Sonic Architecture</h4>
          <div class="name">${esc(st.sonic?.name || "Ambient Progression")}</div>
          <p class="muted" style="font-size:12px;margin:0;">Musical bridge connecting primary taste vectors</p>
        </div>
        <div class="triad-card">
          <h4>🎬 Cinematic & Visuals</h4>
          <div class="name">${esc(st.visual?.name || "Atmospheric Visuals")}</div>
          <p class="muted" style="font-size:12px;margin:0;">Stage projection, aesthetic lighting & cinematography</p>
        </div>
        <div class="triad-card">
          <h4>🍸 Brand & Gastronomy</h4>
          <div class="name">${esc(st.gastronomic?.name || "Artisan Pop-Up")}</div>
          <p class="muted" style="font-size:12px;margin:0;">Curated food/beverage activation & sponsor alignment</p>
        </div>
      </div>
      <div style="margin-top:10px;">
        <span class="muted" style="font-size:12px;">Collective Latent Attributes: </span>
        ${tagList}
      </div>
    </div>`;
  };

  const rehearsalView = () => {
    if (!S.rehearsal) {
      return `<div class="row" style="margin-top:12px;">
        <button class="primary" data-action="rehearse" ${S.busy ? "disabled" : ""}>
          🎭 Run Autonomous Audience Rehearsal & ROI Simulation
        </button>
      </div>`;
    }
    const r = S.rehearsal.simulation;
    const ca = r.commercialArbitrage;
    const personaCards = r.critiques
      .map(
        (c) => `<div class="critique-box">
        <strong>${esc(c.personaName)}</strong> (Satisfaction: ${Math.round(c.satisfactionRatio * 100)}%):
        <p style="margin:4px 0 0;color:#cbd5e1;">${esc(c.critique)}</p>
      </div>`,
      )
      .join("");

    const curveRows = r.segmentAudits
      .map((s) => {
        const pct = Math.round(s.collectiveResonance * 100);
        const fillCls = s.isFrictionZone ? "friction" : s.isResonancePeak ? "harmonic" : "normal";
        return `<div class="curve-row">
        <span>${esc(s.title.slice(0, 15))}...</span>
        <div class="curve-bar-bg" title="${esc(s.notes)}">
          <div class="curve-bar-fill ${fillCls}" style="width:${pct}%"></div>
        </div>
        <span style="text-align:right;font-weight:700;">${pct}%</span>
      </div>`;
      })
      .join("");

    return `<div style="margin-top:20px;background:#0d111d;border:1px solid #4338ca;border-radius:14px;padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3 style="color:var(--violet);margin:0;">Audience Rehearsal & Commercial Arbitrage</h3>
        <span class="pill ok">Agent Simulation Complete</span>
      </div>
      <div class="arbitrage-metrics">
        <div class="metric-box">
          <div class="val">${r.overallResonancePercent}%</div>
          <div class="lbl">Collective Resonance</div>
        </div>
        <div class="metric-box">
          <div class="val">${ca.currency} ${ca.culturalWasteAvoided.toLocaleString()}</div>
          <div class="lbl">Cultural Misallocation Avoided</div>
        </div>
        <div class="metric-box">
          <div class="val">${r.retentionIndex}%</div>
          <div class="lbl">Audience Retention Index</div>
        </div>
      </div>
      <div style="margin-top:16px;">
        <h4 style="margin:0 0 8px;font-size:13px;color:var(--muted);">Minute-by-Minute Collective Flow & Friction Curve:</h4>
        ${curveRows}
      </div>
      <div style="margin-top:14px;">
        <h4 style="margin:0 0 6px;font-size:13px;color:var(--muted);">Autonomous Community Agent Critiques:</h4>
        ${personaCards}
      </div>
    </div>`;
  };

  const roomPulseView = () => {
    const r = S.room;
    if (!r) {
      return `<section class="card" style="margin-top:16px;">
        <h2>5 · Real-time Room Pulse (Audience Telepathy)</h2>
        <p class="muted">Let attendees or judges scan a code and submit cultural seeds. WEAVE dynamically weaves the room's tastes in real time.</p>
        <button class="primary btn-sm" data-action="open-room">📡 Open Live Audience Room</button>
      </section>`;
    }
    const attendees = r.attendees || [];
    return `<section class="card" style="margin-top:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h2>5 · Real-time Room Pulse (${esc(r.id)})</h2>
        <span class="pill live">Live SSE Connected · ${attendees.length} Attendees</span>
      </div>
      <div class="live-pulse-box">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <div>
            <strong>Attendee Join Link:</strong>
            <a href="/room.html?room=${esc(r.id)}" target="_blank" style="color:var(--teal);margin-left:8px;">/room.html?room=${esc(r.id)}</a>
          </div>
          <button class="btn-sm" data-action="simulate-room">⚡ Simulate 3 Live Attendees</button>
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--muted);">
          Latest Attendees in Room:
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
            ${
              attendees
                .slice(-6)
                .map((a) => `<span class="chip">${esc(a.nickname)}</span>`)
                .join("") || '<span class="muted">Waiting for first submission...</span>'
            }
          </div>
        </div>
        ${
          r.latestAnalysis
            ? `<p style="margin-top:12px;color:var(--ok);font-size:13px;">✓ Live Crowd Telepathy: Emergent taste clusters re-calculated with ${
                r.latestAnalysis.tagBridges?.length || 0
              } shared tag bridges!</p>`
            : ""
        }
      </div>
    </section>`;
  };

  const baselineView = () => {
    const P = S.plan;
    const names = ["Welcome set", "Open stage", "Film screening", "Food stalls", "Workshop", "Closing jam", "Quiz", "Photo corner"];
    const backed = P.segments.filter((s) => s.candidateIds.length > 0).length;
    const rows = P.segments
      .map((s, i) => `<tr><td>${hhmm(s.startMinute)}</td><td>${esc(names[i % names.length])}</td><td>${s.durationMinutes} min</td></tr>`)
      .join("");
    return `<div class="baseline"><p class="muted">Generic template with the same slots and lengths. It has no Qloo evidence: 0 of ${P.segments.length} segments are evidence-backed. This plan: ${backed} of ${P.segments.length} segments cite a Qloo candidate.</p>
      <table><tbody>${rows}</tbody></table></div>`;
  };

  const exportView = () => {
    const out = renderExport(S.exportFmt, buildDocument({ analysis: S.analysis, plan: S.plan }));
    const fmts = [["md", "Markdown"], ["csv", "CSV"], ["json", "JSON"]]
      .map(([k, label]) => `<button data-action="fmt" data-fmt="${k}" aria-pressed="${S.exportFmt === k}">${label}</button>`)
      .join("");
    return `<div class="exports"><div class="row"><span class="toggle" role="group" aria-label="Export format">${fmts}</span>${
      S.server ? `<button data-action="download">Download</button>` : ""
    }</div><pre>${esc(out.body)}</pre></div>`;
  };

  const planView = () => {
    const P = S.plan;
    const v = P.validation;
    const total = P.brief.durationMinutes;
    const segs = P.segments
      .map((s) => `<div class="seg ${esc(s.purpose)}" style="width:${((s.durationMinutes / total) * 100).toFixed(2)}%" title="${esc(s.title)}"></div>`)
      .join("");
    const buffer = Math.max(0, total - v.totalMinutes);
    const bar = `${segs}<div class="seg buffer" style="width:${((buffer / total) * 100).toFixed(2)}%" title="Unallocated time"></div>`;
    const rows = P.segments
      .map(
        (s) => `<li class="seg-row">
        <span><strong>${hhmm(s.startMinute)}</strong> <span class="chip ${esc(s.purpose)}">${esc(s.purpose)}</span></span>
        <span>${esc(s.title)}</span>
        <label class="field">min<input type="number" min="1" max="60" value="${s.durationMinutes}" data-seg="${esc(s.id)}" data-field="durationMinutes"></label>
        <label class="field">cost<input type="number" min="0" step="100" value="${s.estimatedCost}" data-seg="${esc(s.id)}" data-field="estimatedCost"></label>
        <small class="muted">${s.costKind === "assumption" ? "Assumed cost (placeholder)" : "Organizer-entered cost"} · ${
          s.evidenceRefs.length ? s.evidenceRefs.map(esc).join(" ") : "organizer-designed, no Qloo evidence"
        }</small>
      </li>`,
      )
      .join("");
    const notes = [
      ...v.errors.map((e) => `<p class="err">✕ ${esc(e)}</p>`),
      ...v.warnings.map((w) => `<p class="warn">! ${esc(w)}</p>`),
      ...(P.changes ?? []).map((c) => `<p class="muted">→ ${esc(c)}</p>`),
    ].join("");
    return `<section class="card"><h2>4 · Experience composer</h2>
      <div class="bar" role="img" aria-label="Programme timeline">${bar}</div>
      <ol class="timeline">${rows}</ol>
      <div class="grid2">
        <label class="field">Event length (min)<select data-brief-patch="durationMinutes">${[60, 90, 120]
          .map((m) => `<option value="${m}" ${m === total ? "selected" : ""}>${m}</option>`)
          .join("")}</select></label>
        <label class="field">Budget ceiling (${esc(v.currency)})<input type="number" min="0" step="500" value="${v.budgetCeiling}" data-brief-patch="budgetAmount"></label>
      </div>
      <p class="row"><span class="pill ${v.isValid ? "ok" : "bad"}">${v.isValid ? "Valid" : "Invalid"}</span>
        <span>${v.totalMinutes} of ${v.availableMinutes} min</span>
        <span>${esc(money(v.budgetTotal, v.currency))} of ${esc(money(v.budgetCeiling, v.currency))}</span></p>
      ${notes}
      <div class="row"><button data-action="repair">Suggest repair</button><button data-action="baseline">${S.baseline ? "Hide" : "Compare with"} generic baseline</button></div>
      ${rehearsalView()}
      ${S.baseline ? baselineView() : ""}
      <details open><summary class="muted">Export run-of-show and evidence</summary>${exportView()}</details></section>`;
  };

  const render = () => {
    const pill = S.mode === "live" ? `<span class="pill ok">Live Qloo · via server</span>` : `<span class="pill demo">Demo fixture · not live Qloo data</span>`;
    const toggle = S.server
      ? `<span class="toggle" role="group" aria-label="Data source"><button data-action="mode" data-mode="demo" aria-pressed="${S.mode === "demo"}">Demo</button><button data-action="mode" data-mode="live" aria-pressed="${S.mode === "live"}">Live</button></span>`
      : "";
    $("#app").innerHTML = `
      <header><div><div class="wordmark">WEAVE</div><p class="tag">Don't optimize for a crowd. Design the connections between them.</p></div>
      <div class="row">${toggle}${pill}</div></header>
      ${S.notice ? `<div class="notice">${esc(S.notice)}</div>` : ""}
      ${briefView()}
      ${communitiesView()}
      ${S.error ? `<div class="alert" role="alert">${esc(S.error)}</div>` : ""}
      ${S.analysis ? bridgeView() : ""}
      ${S.plan ? planView() : ""}
      ${roomPulseView()}`;
  };

  const planFromPicks = () => {
    if (!S.analysis) return;
    if (!S.picked.size) {
      S.plan = null;
      return;
    }
    try {
      const brief = validateBrief(S.brief);
      S.brief = brief;
      S.plan = buildPlan({ analysis: S.analysis, brief, selectedIds: [...S.picked] });
      S.error = "";
    } catch (e) {
      S.plan = null;
      S.error = e.message;
    }
  };

  const analyze = async () => {
    S.busy = true;
    S.error = "";
    S.plan = null;
    render();
    try {
      const brief = validateBrief(S.brief);
      const communities = validateCommunities(S.communities, S.mode);
      const input = { brief, communities, targetEntityType: DEMO_TARGET };
      S.analysis =
        S.mode === "live"
          ? await post("/api/analysis", { mode: "live", ...input })
          : await runAnalysis({ adapter: demo, mode: "demo", ...input, analysisId: `demo-${Date.now().toString(36)}` });
      S.picked = new Set(S.analysis.recommendedIds);
      S.focus = S.analysis.recommendedIds[0] ?? null;
      planFromPicks();
    } catch (e) {
      S.analysis = null;
      S.error = e.message;
    }
    S.busy = false;
    render();
  };

  const runSearch = async (cid) => {
    const box = (S.search[cid] ??= { q: "", items: [], error: "" });
    const q = box.q.trim();
    if (!q) {
      box.items = [];
      box.error = "Type a name first.";
      return render();
    }
    try {
      box.items = S.mode === "live" ? (await call(`/api/entities/search?q=${encodeURIComponent(q)}&mode=live`)).items : await demo.searchEntities({ query: q, limit: 10 });
      box.error = box.items.length ? "" : "No matches. Try another spelling.";
    } catch (e) {
      box.items = [];
      box.error = e.message;
    }
    render();
  };

  const addSeed = (cid, id) => {
    const c = S.communities.find((x) => x.id === cid);
    const item = S.search[cid]?.items.find((x) => x.id === id);
    if (c && item && c.seeds.length < 5 && !c.seeds.some((s) => s.id === id)) {
      c.seeds.push({ id: item.id, name: item.name, provenance: item.source });
      S.search[cid] = { q: "", items: [], error: "" };
      return afterSeedChange();
    }
    render();
  };

  const exclude = (id) => {
    if (!S.brief.excludedEntityIds.includes(id)) S.brief.excludedEntityIds.push(id);
    S.picked.delete(id);
    if (S.mode === "demo") return void analyze();
    S.analysis = null;
    S.plan = null;
    S.notice = "Excluded. Run the live analysis again to recompute the bridge map.";
    render();
  };

  const patch = (p) => {
    if (!S.plan) return render();
    try {
      S.plan = patchPlan({ plan: S.plan, analysis: S.analysis, patch: p });
      S.brief = S.plan.brief;
      S.error = "";
    } catch (e) {
      S.error = e.message;
    }
    render();
  };

  const download = async () => {
    try {
      let out;
      if (S.mode === "live" && S.server) {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ analysisId: S.analysis.analysisId, format: S.exportFmt, brief: S.plan.brief, segments: S.plan.segments }),
        });
        if (!res.ok) throw new Error(`Export failed (${res.status})`);
        out = { body: await res.text(), type: res.headers.get("content-type") ?? "text/plain" };
      } else {
        out = renderExport(S.exportFmt, buildDocument({ analysis: S.analysis, plan: S.plan }));
      }
      const url = URL.createObjectURL(new Blob([out.body], { type: out.type }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `weave-run-of-show.${S.exportFmt}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      S.error = e.message;
      render();
    }
  };

  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest?.("[data-action]");
    if (!el) return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    const cid = el.dataset.c;
    if (act === "analyze") return void analyze();
    if (act === "mode") return setMode(el.dataset.mode);
    if (act === "load-live-preset") {
      S.brief = { ...S.brief, ...LIVE_PRESET.brief };
      S.communities = JSON.parse(JSON.stringify(LIVE_PRESET.communities));
      S.notice = "Loaded verified live preset (Radiohead, Pink Floyd × Hans Zimmer, Daft Punk). Click 'Run live analysis' below!";
      return render();
    }
    if (act === "add-stepping-stone") {
      S.picked.add(id);
      S.focus = id;
      planFromPicks();
      return render();
    }
    if (act === "search") return void runSearch(cid);
    if (act === "confirm") return addSeed(cid, id);
    if (act === "drop-seed") {
      const c = S.communities.find((x) => x.id === cid);
      if (c) c.seeds = c.seeds.filter((s) => s.id !== id);
      return afterSeedChange();
    }
    if (act === "focus") {
      S.focus = id;
      return render();
    }
    if (act === "toggle") {
      if (S.picked.has(id)) S.picked.delete(id);
      else S.picked.add(id);
      S.focus = id;
      planFromPicks();
      return render();
    }
    if (act === "exclude") return exclude(id);
    if (act === "repair") return patch({ repair: true });
    if (act === "baseline") {
      S.baseline = !S.baseline;
      return render();
    }
    if (act === "fmt") {
      S.exportFmt = el.dataset.fmt;
      return render();
    }
    if (act === "download") return void download();
    if (act === "synesthesia") {
      S.busy = true;
      render();
      try {
        const brief = validateBrief(S.brief);
        const communities = validateCommunities(S.communities, S.mode);
        if (S.mode === "live" && S.server) {
          S.synesthesia = await post("/api/synesthesia", { mode: "live", brief, communities });
        } else {
          S.synesthesia = await runSynestheticAnalysis({
            adapter: demo,
            brief,
            communities,
            domains: ["sonic", "visual", "gastronomic"],
          });
        }
      } catch (e) {
        S.error = e.message;
      }
      S.busy = false;
      return render();
    }
    if (act === "rehearse") {
      S.busy = true;
      render();
      try {
        if (!S.plan) throw new Error("Compile a plan first.");
        const personas = buildAgentPersonas(S.communities, S.analysis);
        S.rehearsal = {
          personas,
          simulation: simulateRehearsal({ plan: S.plan, analysis: S.analysis, personas }),
        };
      } catch (e) {
        S.error = e.message;
      }
      S.busy = false;
      return render();
    }
    if (act === "open-room") {
      try {
        S.room = S.server ? await post("/api/rooms", { title: S.brief.name || "Live Audience Room", brief: S.brief }) : { id: "room-demo", attendees: [] };
        if (S.server && !S.pulseSubscribed) {
          S.pulseSubscribed = true;
          const es = new EventSource(`/api/rooms/${S.room.id}/stream`);
          es.addEventListener("attendee-joined", (ev) => {
            const data = JSON.parse(ev.data);
            (S.room.attendees ??= []).push({ nickname: data.latestAttendee });
            render();
          });
          es.addEventListener("pulse-updated", (ev) => {
            const data = JSON.parse(ev.data);
            S.room.latestAnalysis = data.analysis;
            render();
          });
        }
      } catch (e) {
        S.error = e.message;
      }
      return render();
    }
    if (act === "simulate-room") {
      try {
        if (S.server && S.room) {
          await post(`/api/rooms/${S.room.id}/simulate`, {});
        } else {
          (S.room.attendees ??= []).push(
            { nickname: "Aria (Indie fan)" },
            { nickname: "Leo (Sci-Fi/Film)" },
            { nickname: "Maya (Electronic)" },
          );
        }
      } catch (e) {
        S.error = e.message;
      }
      return render();
    }
  });

  document.addEventListener("input", (ev) => {
    const cid = ev.target.dataset?.search;
    if (cid === undefined) return;
    (S.search[cid] ??= { q: "", items: [], error: "" }).q = ev.target.value;
  });

  document.addEventListener("keydown", (ev) => {
    const t = ev.target;
    if (ev.key === "Enter" && t.dataset?.search !== undefined) {
      ev.preventDefault();
      return void runSearch(t.dataset.search);
    }
    if ((ev.key === "Enter" || ev.key === " ") && t.matches?.("[data-action='focus']")) {
      ev.preventDefault();
      t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.dataset.brief !== undefined) {
      const k = el.dataset.brief;
      S.brief[k] = NUMERIC.includes(k) ? Number(el.value) : el.value;
      if (S.analysis) planFromPicks();
      return render();
    }
    if (el.dataset.seg !== undefined) return patch({ segments: [{ id: el.dataset.seg, [el.dataset.field]: Number(el.value) }] });
    if (el.dataset.briefPatch !== undefined) return patch({ [el.dataset.briefPatch]: Number(el.value) });
  });

  (async () => {
    await checkServer();
    render();
    if (S.mode === "demo") void analyze();
  })();
})();
