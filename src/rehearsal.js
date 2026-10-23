// WEAVE Audience Rehearsal Engine & Commercial Resonance Arbitrage.
// Simulates autonomous community personas attending the planned run-of-show minute-by-minute.
// Produces an empirical Resonance Curve, detects Friction Zones, and computes Cultural Waste Arbitrage.
import { round4 } from "./core.js";

function harmonicMean(numbers) {
  const valid = numbers.filter((n) => Number.isFinite(n) && n > 0.001);
  if (!valid.length) return 0;
  const sumInv = valid.reduce((acc, n) => acc + 1 / n, 0);
  return valid.length / sumInv;
}

export function buildAgentPersonas(communities, analysis) {
  return communities.map((c) => {
    // Find all tags associated with this community from analysis results
    const communityResults = analysis.communities.find((x) => x.id === c.id)?.results || [];
    const tagWeights = {};
    for (const r of communityResults) {
      for (const t of r.tags || []) {
        tagWeights[t.name] = (tagWeights[t.name] || 0) + (1 / Math.max(1, r.rank));
      }
    }
    const topTags = Object.entries(tagWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name);

    return {
      id: c.id,
      name: c.name,
      description: c.description || `Audience segment focused on ${c.name}`,
      priority: c.priority || 2,
      seeds: c.seeds.map((s) => s.name),
      topTags,
      tagWeights,
    };
  });
}

export function simulateRehearsal({ plan, analysis, personas }) {
  const segments = plan.segments || [];
  const cids = personas.map((p) => p.id);
  const byCandidate = new Map((analysis.candidates || []).map((c) => [c.id, c]));

  // Evaluate each segment across personas
  const segmentAudits = segments.map((seg) => {
    const scores = {};
    const candidate = seg.candidateIds?.[0] ? byCandidate.get(seg.candidateIds[0]) : null;

    for (const p of personas) {
      if (candidate) {
        const inComm = candidate.communitiesCovered?.includes(p.id);
        const rank = candidate.perCommunityRank?.[p.id];
        if (inComm && rank) {
          // Direct affinity from recommendation rank
          scores[p.id] = Math.max(0.3, 1 - (rank - 1) / 15);
        } else {
          // Check tag overlap between candidate tags and persona's top tags
          const candTags = (candidate.tags || []).map((t) => t.name || t);
          const shared = candTags.filter((t) => p.topTags.includes(t));
          scores[p.id] = shared.length > 0 ? Math.min(0.75, 0.2 + shared.length * 0.15) : 0.18;
        }
      } else if (seg.purpose === "break") {
        scores[p.id] = 0.55; // Neutral baseline during intermission
      } else if (seg.purpose === "co-creation") {
        scores[p.id] = 0.72; // High shared engagement for interactive participation
      } else {
        scores[p.id] = 0.45;
      }
    }

    const scoreVals = Object.values(scores);
    const minScore = Math.min(...scoreVals);
    const maxScore = Math.max(...scoreVals);
    const collectiveResonance = harmonicMean(scoreVals);
    const isFrictionZone = maxScore - minScore > 0.45;
    const isResonancePeak = collectiveResonance >= 0.7;

    return {
      segmentId: seg.id,
      title: seg.title,
      purpose: seg.purpose,
      startMinute: seg.startMinute,
      durationMinutes: seg.durationMinutes,
      estimatedCost: seg.estimatedCost,
      scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round4(v)])),
      collectiveResonance: round4(collectiveResonance),
      isFrictionZone,
      isResonancePeak,
      notes: isFrictionZone
        ? `Cultural disparity detected: one community scored ${(maxScore * 100).toFixed(0)}% while another scored ${(minScore * 100).toFixed(0)}%.`
        : isResonancePeak
        ? `Harmonic resonance: collective score at ${(collectiveResonance * 100).toFixed(0)}%.`
        : "Balanced audience engagement.",
    };
  });

  // Calculate overall timeline metrics & Commercial Arbitrage
  const totalMinutes = segments.reduce((acc, s) => acc + (s.durationMinutes || 0), 0) || 1;
  const weightedResonance =
    segmentAudits.reduce((acc, s) => acc + s.collectiveResonance * s.durationMinutes, 0) / totalMinutes;

  const frictionCount = segmentAudits.filter((s) => s.isFrictionZone).length;
  const peakCount = segmentAudits.filter((s) => s.isResonancePeak).length;

  // Commercial Arbitrage Math:
  // A generic lineup alienates communities during single-interest acts.
  // Weave's cross-community planning avoids cultural budget waste.
  const budget = plan.brief?.budgetAmount || 25000;
  const currency = plan.brief?.currency || "INR";
  const frictionMinutes = segmentAudits
    .filter((s) => s.isFrictionZone)
    .reduce((acc, s) => acc + s.durationMinutes, 0);
  const wasteFraction = frictionMinutes / totalMinutes;
  const culturalWasteAvoided = Math.round(budget * (1 - wasteFraction) * 0.45);
  const retentionIndex = Math.min(98, Math.max(50, Math.round(weightedResonance * 100 + (1 - wasteFraction) * 15)));

  // Generate Persona Critiques
  const critiques = personas.map((p) => {
    const pScores = segmentAudits.map((s) => s.scores[p.id]);
    const avgP = pScores.reduce((a, b) => a + b, 0) / pScores.length;
    const favorite = segmentAudits.reduce((prev, curr) => (curr.scores[p.id] > prev.scores[p.id] ? curr : prev));
    const lowest = segmentAudits.reduce((prev, curr) => (curr.scores[p.id] < prev.scores[p.id] ? curr : prev));

    let critique = `As a voice for ${p.name}, our overall satisfaction is ${(avgP * 100).toFixed(0)}%. `;
    critique += `Highlight: "${favorite.title}" strongly aligns with our affinity for ${p.topTags.slice(0, 3).join(", ")}. `;
    if (lowest.scores[p.id] < 0.4) {
      critique += `Caution: "${lowest.title}" felt detached from our preferences. Consider inserting a stepping-stone bridge.`;
    } else {
      critique += `The journey maintains steady cultural respect throughout.`;
    }

    return {
      personaId: p.id,
      personaName: p.name,
      satisfactionRatio: round4(avgP),
      critique,
    };
  });

  return {
    timelineDuration: totalMinutes,
    overallResonancePercent: Math.round(weightedResonance * 100),
    retentionIndex,
    commercialArbitrage: {
      budgetTotal: budget,
      currency,
      culturalWasteAvoided,
      frictionZoneCount: frictionCount,
      resonancePeakCount: peakCount,
      summary: `Estimated ${currency} ${culturalWasteAvoided.toLocaleString()} in cultural misallocation avoided by bridging taste vectors.`,
    },
    segmentAudits,
    critiques,
  };
}
