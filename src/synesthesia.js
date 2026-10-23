// WEAVE Synesthesia: Multi-Modal Cultural Synthesis.
// Human experiences are multi-sensory: sound, visuals, and gastronomy.
// This module queries Qloo across multiple entity domains (Artists, Movies, Brands/Dining)
// using the same confirmed community seeds to assemble 360° sensory bridge packages.
import { scoreCandidates, computeTagBridges } from "./core.js";

export const SENSORY_DOMAINS = {
  sonic: { type: "urn:entity:artist", label: "Sonic Architecture", icon: "🎵" },
  visual: { type: "urn:entity:movie", label: "Cinematic & Visual Atmosphere", icon: "🎬" },
  gastronomic: { type: "urn:entity:brand", label: "Culinary & Brand Activation", icon: "🍸" },
};

export async function runSynestheticAnalysis({
  adapter,
  brief,
  communities,
  domains = ["sonic", "visual", "gastronomic"],
  takePerDomain = 6,
}) {
  const seedIds = communities.flatMap((c) => c.seeds.map((s) => s.id));
  const excluded = new Set([...seedIds, ...(brief.excludedEntityIds ?? [])]);
  const resultsByDomain = {};
  let totalCalls = 0;

  for (const domainKey of domains) {
    const domainDef = SENSORY_DOMAINS[domainKey];
    if (!domainDef) continue;
    const lists = {};

    for (const c of communities) {
      try {
        totalCalls += 1;
        const recs = await adapter.getRecommendations({
          entityType: domainDef.type,
          seedEntityIds: c.seeds.map((s) => s.id),
          excludedEntityIds: [...excluded],
          limit: takePerDomain,
        });
        lists[c.id] = recs || [];
      } catch {
        lists[c.id] = [];
      }
    }

    const scored = scoreCandidates(lists, excluded);
    const tagBridges = computeTagBridges(lists);
    resultsByDomain[domainKey] = {
      domain: domainKey,
      label: domainDef.label,
      icon: domainDef.icon,
      entityType: domainDef.type,
      candidates: scored,
      tagBridges,
      topBridge: scored.find((c) => c.isBridge) || scored[0] || null,
    };
  }

  // Synthesize complete 360° Sensory Triad (Sound + Visual + Brand)
  const sensoryTriad = {
    sonic: resultsByDomain.sonic?.topBridge || null,
    visual: resultsByDomain.visual?.topBridge || null,
    gastronomic: resultsByDomain.gastronomic?.topBridge || null,
    collectiveTags: [
      ...new Set([
        ...(resultsByDomain.sonic?.tagBridges?.map((t) => t.name) || []),
        ...(resultsByDomain.visual?.tagBridges?.map((t) => t.name) || []),
        ...(resultsByDomain.gastronomic?.tagBridges?.map((t) => t.name) || []),
      ]),
    ].slice(0, 12),
  };

  return {
    resultsByDomain,
    sensoryTriad,
    calls: totalCalls,
  };
}
