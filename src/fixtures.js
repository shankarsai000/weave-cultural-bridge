// DEMO FIXTURES. Synthetic entities for offline demos. They are not Qloo output. The demo adapter ranks by shared
// tags so results react to seed changes, and every record carries source "demo-fixture".
export const DEMO_TARGET = "urn:entity:artist";

const RAW = [
  ["demo:e01", "Neon Tide", "synth j-pop anime"],
  ["demo:e02", "Quiet Harbour Trio", "folk acoustic indie"],
  ["demo:e03", "Pixel Mercury", "chiptune gaming electronic"],
  ["demo:e04", "Lantern Sound", "indie electronic festival"],
  ["demo:e05", "Night Tram Records", "jazz indie lofi"],
  ["demo:e06", "Rhythm Forge Ensemble", "taiko drums festival"],
  ["demo:e07", "Afterimage (film)", "film cyberpunk gaming"],
  ["demo:e08", "Glass Circuit Live", "gaming electronic synth"],
  ["demo:e09", "Street Thread Label", "streetwear hip-hop fashion"],
  ["demo:e10", "Monsoon Beats Crew", "hip-hop indie festival"],
  ["demo:e11", "Dub Lantern Sound", "dub electronic reggae"],
  ["demo:e12", "Chai and Synth Session", "food electronic lofi"],
  ["demo:e13", "Ramen Night Cinema", "food film anime"],
  ["demo:e14", "Polyglot Poetry Circle", "language spoken-word indie"],
  ["demo:e15", "Retro Arcade Orchestra", "chiptune orchestral gaming"],
  ["demo:e16", "Mountain Radio Folk", "folk indie acoustic"],
];

export const DEMO_POOL = RAW.map(([id, name, tags]) => ({ id, name, type: DEMO_TARGET, tags: tags.split(" ") }));

export const DEMO_PRESET = [
  { id: "anime-gaming", name: "Anime and gaming", description: "Organizer-defined programming segment", priority: 2, seedIds: ["demo:e01", "demo:e03"] },
  { id: "indie-folk", name: "Indie and folk", description: "Organizer-defined programming segment", priority: 3, seedIds: ["demo:e02", "demo:e05"] },
  { id: "food-language", name: "Food and language clubs", description: "Organizer-defined programming segment", priority: 1, seedIds: ["demo:e12", "demo:e14"] },
];

// Stand-in for Qloo Insights: ranks pool entities by shared tags with the seeds, skipping seeds and exclusions.
export function createDemoAdapter(pool = DEMO_POOL) {
  const byId = new Map(pool.map((e) => [e.id, e]));
  const out = (e) => ({ id: e.id, name: e.name, type: e.type, source: "demo-fixture", upstream: {} });
  return {
    async searchEntities({ query = "", limit = 10 } = {}) {
      const q = String(query).trim().toLowerCase();
      return pool.filter((e) => e.name.toLowerCase().includes(q)).slice(0, limit).map(out);
    },
    async getRecommendations({ seedEntityIds = [], excludedEntityIds = [], limit = 10 } = {}) {
      const seeds = seedEntityIds.map((id) => byId.get(id));
      if (!seeds.length || seeds.some((s) => !s)) {
        throw Object.assign(new Error("unknown demo seed"), { code: "ENTITY_NOT_FOUND" });
      }
      const skip = new Set([...seedEntityIds, ...excludedEntityIds]);
      return pool
        .filter((e) => !skip.has(e.id))
        .map((e) => ({ e, score: seeds.reduce((s, sd) => s + sd.tags.filter((t) => e.tags.includes(t)).length, 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.e.id < b.e.id ? -1 : 1))
        .slice(0, limit)
        .map((x) => out(x.e));
    },
  };
}
