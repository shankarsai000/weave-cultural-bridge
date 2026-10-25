import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNaturalLanguageBrief, performAgenticPlanRepair } from "../src/agent.js";

test("Agent Brief Parser: extracts duration, budget, currency and contrasting communities from festival prompt", () => {
  const prompt = "We're organizing a 3-hour campus mixer in Bengaluru for 300 students bridging anime gaming and indie folk acoustic lovers with a budget of ₹35,000";
  const result = parseNaturalLanguageBrief(prompt);

  assert.equal(result.brief.durationMinutes, 180);
  assert.equal(result.brief.budgetAmount, 35000);
  assert.equal(result.brief.currency, "INR");
  assert.equal(result.brief.capacity, 300);
  assert.ok(result.communities.length >= 2);
  assert.ok(result.communities.some(c => c.name.includes("Anime") || c.name.includes("Gaming")));
  assert.ok(result.communities.some(c => c.name.includes("Indie") || c.name.includes("Folk")));
});

test("Agent Tradeoff Repair: automatically resolves duration overrun and budget excess", () => {
  const mockPlan = {
    brief: { durationMinutes: 60, budgetAmount: 2000, currency: "INR" },
    segments: [
      { id: "seg-1", title: "Act 1", purpose: "bridge", durationMinutes: 40, estimatedCost: 1500 },
      { id: "seg-2", title: "Break", purpose: "break", durationMinutes: 15, estimatedCost: 500 },
      { id: "seg-3", title: "Act 2", purpose: "recognition", durationMinutes: 30, estimatedCost: 1500 },
    ],
    validation: { totalMinutes: 85, budgetTotal: 3500 }
  };

  const repair = performAgenticPlanRepair({ plan: mockPlan });
  assert.equal(repair.isNowValid, true);
  assert.ok(repair.actionsTaken.length > 0);

  const totalMins = repair.repairedSegments.reduce((sum, s) => sum + s.durationMinutes, 0);
  assert.ok(totalMins <= 60);

  const totalCost = repair.repairedSegments.reduce((sum, s) => sum + s.estimatedCost, 0);
  assert.ok(totalCost <= 2000);
});
