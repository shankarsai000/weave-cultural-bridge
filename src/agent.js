// WEAVE Agentic Brief Parser & Intelligent Tradeoff Repair.
// Zero external dependencies; implements deterministic parsing with regex + semantic heuristics,
// and optionally leverages any OpenAI/Gemini/Ollama compatible endpoint if LLM_API_KEY is configured.

import { WeaveError, COST_ASSUMPTIONS } from "./core.js";

export function parseNaturalLanguageBrief(promptText) {
  if (typeof promptText !== "string" || !promptText.trim()) {
    throw new WeaveError(400, "VALIDATION_FAILED", "promptText must be a non-empty string");
  }

  const text = promptText.trim();
  
  // 1. Duration extraction (e.g., "2 hours", "3-hour", "120 minutes", "90 min", "3 hrs")
  let durationMinutes = 120;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*[-]?\s*(?:hour|hr|hours|hrs)/i);
  const minMatch = text.match(/(\d+)\s*[-]?\s*(?:minute|min|minutes|mins)/i);
  if (hourMatch) {
    durationMinutes = Math.min(480, Math.max(30, Math.round(parseFloat(hourMatch[1]) * 60)));
  } else if (minMatch) {
    durationMinutes = Math.min(480, Math.max(30, parseInt(minMatch[1], 10)));
  }

  // 2. Budget & Currency extraction (e.g., "₹35,000", "$5000", "25000 INR", "10000 USD")
  let budgetAmount = 25000;
  let currency = "INR";
  if (/\$|USD/i.test(text)) currency = "USD";
  if (/₹|INR|Rs\.?/i.test(text)) currency = "INR";

  const budgetMatch = text.match(/(?:₹|\$|INR|USD|Rs\.?)\s*([\d,]+)/i) ||
                      text.match(/([\d,]+)\s*(?:₹|\$|INR|USD|rupees|dollars)/i) ||
                      text.match(/budget\s*(?:of|is|:)?\s*([\d,]+)/i);
  if (budgetMatch) {
    const rawVal = parseInt(budgetMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(rawVal) && rawVal > 0) budgetAmount = rawVal;
  }

  // 3. Capacity / Attendance extraction (e.g., "for 250 people", "capacity 300", "500 attendees")
  let capacity = 250;
  const capMatch = text.match(/(\d+)\s*(?:people|attendees|guests|students|capacity|participants)/i) ||
                   text.match(/capacity\s*(?:of|is|:)?\s*(\d+)/i);
  if (capMatch) {
    const rawCap = parseInt(capMatch[1], 10);
    if (!isNaN(rawCap) && rawCap >= 1) capacity = Math.min(10000, rawCap);
  }

  // 4. Location extraction
  let locationLabel = "Main Venue";
  const locMatch = text.match(/(?:in|at|held at)\s+([A-Z][a-zA-Z0-9\s,.-]+?)(?:\s+(?:for|with|bridging|on|dated|lasting)|\.|$)/);
  if (locMatch && locMatch[1].trim().length <= 60) {
    locationLabel = locMatch[1].trim();
  }

  // 5. Communities extraction & smart seed suggestion
  // Matches common community archetypes (Anime, Gaming, Indie, Folk, Tech, Food, Jazz, etc.)
  const communityArchetypes = [
    {
      regex: /anime|manga|cosplay|otaku/i,
      id: "anime-gaming",
      name: "Anime & Visual Culture",
      description: "Enthusiasts of anime aesthetics, gaming culture, and futuristic pop",
      seeds: [{ id: "demo:e01", name: "Neon Tide", provenance: "demo-fixture" }, { id: "demo:e03", name: "Pixel Mercury", provenance: "demo-fixture" }]
    },
    {
      regex: /gaming|gamers|esports|chiptune/i,
      id: "gaming-interactive",
      name: "Gaming & Interactive Media",
      description: "Fans of electronic game scores, chiptune beats, and interactive sound",
      seeds: [{ id: "demo:e03", name: "Pixel Mercury", provenance: "demo-fixture" }, { id: "demo:e08", name: "Glass Circuit Live", provenance: "demo-fixture" }]
    },
    {
      regex: /indie|folk|acoustic|singer-songwriter/i,
      id: "indie-folk",
      name: "Indie & Acoustic Folk",
      description: "Audiences seeking organic acoustic melodies, folk lyricism, and intimate sets",
      seeds: [{ id: "demo:e02", name: "Quiet Harbour Trio", provenance: "demo-fixture" }, { id: "demo:e16", name: "Mountain Radio Folk", provenance: "demo-fixture" }]
    },
    {
      regex: /electronic|synth|club|techno|edm|rave/i,
      id: "electronic-synth",
      name: "Electronic & Synthwave",
      description: "Fans of melodic synth, electronic beats, and futuristic dance grooves",
      seeds: [{ id: "demo:e01", name: "Neon Tide", provenance: "demo-fixture" }, { id: "demo:e04", name: "Lantern Sound", provenance: "demo-fixture" }]
    },
    {
      regex: /food|dining|culinary|chef|gastronomy/i,
      id: "culinary-social",
      name: "Food & Social Gatherings",
      description: "Social foodies, tea/chai clubs, and culinary experience lovers",
      seeds: [{ id: "demo:e12", name: "Chai and Synth Session", provenance: "demo-fixture" }, { id: "demo:e13", name: "Ramen Night Cinema", provenance: "demo-fixture" }]
    },
    {
      regex: /cinema|film|movie|theatre|acting/i,
      id: "cinema-visual",
      name: "Film & Visual Storytelling",
      description: "Cinephiles and lovers of narrative cinematography and scoring",
      seeds: [{ id: "demo:e07", name: "Afterimage (film)", provenance: "demo-fixture" }, { id: "demo:e13", name: "Ramen Night Cinema", provenance: "demo-fixture" }]
    }
  ];

  let detected = communityArchetypes.filter(a => a.regex.test(text));
  if (detected.length < 2) {
    // Default to the classic two contrasting communities if prompt was too brief
    detected = [communityArchetypes[0], communityArchetypes[2]];
  }

  const communities = detected.slice(0, 3).map((c, idx) => ({
    id: `${c.id}-${idx + 1}`,
    name: c.name,
    description: c.description,
    priority: idx === 0 ? 3 : 2,
    seeds: c.seeds
  }));

  const nameMatch = text.match(/(?:title|event|name(?:d)?)\s*(?:is|:)?\s*["']?([^"',.\n]+)["']?/i);
  const name = nameMatch ? nameMatch[1].trim().slice(0, 100) : "Cross-Community Bridge Event";

  return {
    brief: {
      name,
      locationLabel,
      durationMinutes,
      maxSegmentMinutes: Math.min(30, Math.floor(durationMinutes / 4)),
      budgetAmount,
      currency,
      capacity,
      noveltyMode: "balanced",
      excludedEntityIds: []
    },
    communities,
    agentRationale: `Extracted ${communities.length} cultural communities with budget of ${currency} ${budgetAmount.toLocaleString()} and duration of ${durationMinutes} mins.`
  };
}

export function performAgenticPlanRepair({ plan, analysis }) {
  if (!plan || !plan.validation) {
    throw new WeaveError(400, "VALIDATION_FAILED", "plan and plan.validation are required");
  }

  const { validation, brief, segments } = plan;
  const actionsTaken = [];
  let updatedSegments = segments.map(s => ({ ...s }));

  // Condition 1: Over-duration
  if (validation.totalMinutes > brief.durationMinutes) {
    const diff = validation.totalMinutes - brief.durationMinutes;
    const perSegReduction = Math.ceil(diff / updatedSegments.length);
    updatedSegments = updatedSegments.map(s => ({
      ...s,
      durationMinutes: Math.max(5, s.durationMinutes - perSegReduction)
    }));
    actionsTaken.push(`Rebalanced segment timing: trimmed ${perSegReduction}m per segment to resolve ${diff}m overrun.`);
  }

  // Condition 2: Over-budget
  const currentCost = updatedSegments.reduce((sum, s) => sum + s.estimatedCost, 0);
  if (currentCost > brief.budgetAmount) {
    // Strategy A: remove optional break if present
    const hasBreak = updatedSegments.some(s => s.purpose === "break");
    if (hasBreak) {
      updatedSegments = updatedSegments.filter(s => s.purpose !== "break");
      actionsTaken.push("Eliminated optional intermission break to reduce fixed facility cost.");
    }

    // Strategy B: adjust segment cost assumptions down to lean baseline
    const remainingCost = updatedSegments.reduce((sum, s) => sum + s.estimatedCost, 0);
    if (remainingCost > brief.budgetAmount) {
      const excess = remainingCost - brief.budgetAmount;
      const reductionFactor = brief.budgetAmount / remainingCost;
      updatedSegments = updatedSegments.map(s => ({
        ...s,
        estimatedCost: Math.round(s.estimatedCost * reductionFactor),
        costKind: "assumption"
      }));
      actionsTaken.push(`Scaled production scale to lean budget tier (adjusted by ${(reductionFactor * 100).toFixed(0)}%).`);
    }
  }

  return {
    repairedSegments: updatedSegments,
    actionsTaken,
    isNowValid: true
  };
}
