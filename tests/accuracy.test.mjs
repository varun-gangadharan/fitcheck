/**
 * Accuracy regression tests.
 *
 * Each scenario describes a real-world situation with a known correct answer.
 * If a change causes any of these to fail, it means the rules engine has
 * regressed on a case it previously handled correctly.
 *
 * To add a new case: reproduce it from the real world, note the expected
 * outcome, and add it here so it never regresses silently.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeFit } from "../src/backend/recommendation-engine.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHART_WITH_MEASUREMENTS = {
  sourceText: "Size chart",
  tables: [
    {
      caption: "",
      columns: ["Size", "Chest"],
      rows: [
        { Size: "S", Chest: "36" },
        { Size: "M", Chest: "40" },
        { Size: "L", Chest: "44" },
        { Size: "XL", Chest: "48" }
      ]
    }
  ]
};

const BOTTOMS_CHART = {
  sourceText: "Waist chart",
  tables: [
    {
      caption: "",
      columns: ["Size", "Waist"],
      rows: [
        { Size: "28", Waist: "28" },
        { Size: "30", Waist: "30" },
        { Size: "32", Waist: "32" },
        { Size: "34", Waist: "34" }
      ]
    }
  ]
};

const SHOES_CHART = {
  sourceText: "Shoe size guide",
  tables: [
    {
      caption: "",
      columns: ["US", "EU", "Foot Length (cm)"],
      rows: [
        { US: "8", EU: "41", "Foot Length (cm)": "26.0" },
        { US: "8.5", EU: "41.5", "Foot Length (cm)": "26.5" },
        { US: "9", EU: "42", "Foot Length (cm)": "27.0" },
        { US: "9.5", EU: "42.5", "Foot Length (cm)": "27.5" },
        { US: "10", EU: "43", "Foot Length (cm)": "28.0" }
      ]
    }
  ]
};

const baseTop = {
  url: "https://shop.example/top",
  brand: "Acme",
  title: "Cotton Shirt",
  category: "tops",
  sizeOptions: ["XS", "S", "M", "L", "XL"],
  sizeChart: CHART_WITH_MEASUREMENTS,
  fitSignals: [],
  extractedSignals: { missingFields: [] }
};

const baseBottom = {
  url: "https://shop.example/jeans",
  brand: "Acme",
  title: "Slim Jeans",
  category: "bottoms",
  sizeOptions: ["28", "30", "32", "34"],
  sizeChart: BOTTOMS_CHART,
  fitSignals: [],
  extractedSignals: { missingFields: [] }
};

const lightweightProfile = {
  mode: "lightweight",
  usualSizes: { tops: "M", bottoms: "30" },
  fitPreference: { tops: "regular", bottoms: "regular" },
  measurements: {}
};

const exactProfile = {
  mode: "exact",
  usualSizes: { tops: "M", bottoms: "30" },
  fitPreference: { tops: "regular", bottoms: "regular" },
  measurements: { chestBust: "41", waist: "31" }
};

const shoeProduct = {
  url: "https://shop.example/shoe",
  brand: "Stride",
  title: "Air Trainer Pro",
  category: "shoes",
  price: "$130",
  sizeOptions: ["8", "8.5", "9", "9.5", "10"],
  sizeChart: SHOES_CHART,
  fitSignals: [],
  extractedSignals: { missingFields: [] }
};

// ---------------------------------------------------------------------------
// Scenario 1: No evidence, no chart match → usual size, moderate risk
// ---------------------------------------------------------------------------
test("accuracy: no evidence → returns usual size with moderate risk", () => {
  const result = analyzeFit({ product: baseTop, profile: lightweightProfile });

  assert.equal(result.suggestedSize, "M", "Should default to the user's usual tops size");
  assert.ok(result.riskScore >= 20 && result.riskScore <= 55, `Risk should be moderate, got ${result.riskScore}`);
  assert.ok(result.confidence >= 0.4 && result.confidence <= 0.8, `Confidence should be moderate, got ${result.confidence}`);
});

// ---------------------------------------------------------------------------
// Scenario 2: Product page says "runs small" → size up from usual
// ---------------------------------------------------------------------------
test("accuracy: product page 'runs small' → size up from usual", () => {
  const result = analyzeFit({
    product: {
      ...baseTop,
      fitSignals: [{ type: "runs_small", label: "Runs small", text: "This item runs small." }]
    },
    profile: lightweightProfile
  });

  assert.equal(result.suggestedSize, "L", "Runs-small signal should push up one size from M");
  assert.ok(result.riskScore > 30, "Risk should be elevated for runs-small items");
  assert.ok(result.ruleSignals.some((s) => s.id === "runs_small"));
});

// ---------------------------------------------------------------------------
// Scenario 3: Product page says "runs large" → size down from usual
// ---------------------------------------------------------------------------
test("accuracy: product page 'runs large' → size down from usual", () => {
  const result = analyzeFit({
    product: {
      ...baseTop,
      fitSignals: [{ type: "runs_large", label: "Runs large", text: "This item runs large." }]
    },
    profile: lightweightProfile
  });

  assert.equal(result.suggestedSize, "S", "Runs-large signal should push down one size from M");
  assert.ok(result.ruleSignals.some((s) => s.id === "runs_large"));
});

// ---------------------------------------------------------------------------
// Scenario 4: True-to-size + chart → low risk, usual size
// ---------------------------------------------------------------------------
test("accuracy: true-to-size signal + chart → low risk, usual size", () => {
  const result = analyzeFit({
    product: {
      ...baseTop,
      fitSignals: [{ type: "true_to_size", label: "True to size", text: "True to size." }]
    },
    profile: lightweightProfile
  });

  assert.equal(result.suggestedSize, "M");
  assert.ok(result.riskScore < 35, `Risk should be low with TTS signal, got ${result.riskScore}`);
  assert.ok(result.ruleSignals.some((s) => s.id === "true_to_size"));
});

// ---------------------------------------------------------------------------
// Scenario 5: Exact mode with measurements → chart-derived size wins
// ---------------------------------------------------------------------------
test("accuracy: exact mode, chest=41 → chart maps to L", () => {
  // Chart: S≤36, M≤40, L≤44, XL≤48. Chest 41 → L.
  const result = analyzeFit({ product: baseTop, profile: exactProfile });

  assert.equal(result.suggestedSize, "L", "Measurement 41 should map to L per chart");
  assert.ok(result.ruleSignals.some((s) => s.id === "measurement_chart_match"));
});

// ---------------------------------------------------------------------------
// Scenario 6: Exact mode, bottoms waist measurement
// ---------------------------------------------------------------------------
test("accuracy: exact mode, waist=31 → chart maps to 32", () => {
  // Chart: 28≤28, 30≤30, 32≤32, 34≤34. Waist 31 → 32.
  const result = analyzeFit({ product: baseBottom, profile: exactProfile });

  assert.equal(result.suggestedSize, "32", "Waist 31 should map to size 32 per chart");
  assert.ok(result.ruleSignals.some((s) => s.id === "measurement_chart_match"));
});

// ---------------------------------------------------------------------------
// Scenario 7: Missing size chart → elevated risk
// ---------------------------------------------------------------------------
test("accuracy: missing size chart → risk is elevated", () => {
  const result = analyzeFit({
    product: { ...baseTop, sizeChart: { sourceText: "", tables: [] } },
    profile: lightweightProfile
  });

  assert.ok(result.riskScore >= 45, `Risk should be high without chart, got ${result.riskScore}`);
  assert.ok(result.ruleSignals.some((s) => s.id === "missing_size_chart"));
});

// ---------------------------------------------------------------------------
// Scenario 8: Prior bad outcome (returned same brand) → risk spikes
// ---------------------------------------------------------------------------
test("accuracy: prior return for same brand raises risk significantly", () => {
  const baseline = analyzeFit({ product: baseTop, profile: lightweightProfile });

  const withHistory = analyzeFit({
    product: baseTop,
    profile: lightweightProfile,
    history: [
      { product: { brand: "Acme", title: "Linen Shirt" }, outcome: "returned" }
    ]
  });

  assert.ok(
    withHistory.riskScore > baseline.riskScore + 8,
    `Prior return should raise risk by at least 8. Baseline: ${baseline.riskScore}, with history: ${withHistory.riskScore}`
  );
  assert.ok(withHistory.ruleSignals.some((s) => s.id === "prior_bad_outcomes"));
});

// ---------------------------------------------------------------------------
// Scenario 9: Relaxed fit preference + no signals → bias up
// ---------------------------------------------------------------------------
test("accuracy: relaxed fit preference biases size up", () => {
  const regular = analyzeFit({ product: baseTop, profile: lightweightProfile });
  const relaxed = analyzeFit({
    product: baseTop,
    profile: { ...lightweightProfile, fitPreference: { tops: "relaxed" } }
  });

  // Relaxed preference should push size up from whatever regular gives.
  const ALPHA = ["XS", "S", "M", "L", "XL"];
  const regularIdx = ALPHA.indexOf(regular.suggestedSize);
  const relaxedIdx = ALPHA.indexOf(relaxed.suggestedSize);
  assert.ok(relaxedIdx > regularIdx, `Relaxed fit (${relaxed.suggestedSize}) should be larger than regular (${regular.suggestedSize})`);
  assert.ok(relaxed.ruleSignals.some((s) => s.id === "relaxed_preference"));
});

// ---------------------------------------------------------------------------
// Scenario 10: Snug fit preference + no signals → bias down
// ---------------------------------------------------------------------------
test("accuracy: snug fit preference biases size down", () => {
  const regular = analyzeFit({ product: baseTop, profile: lightweightProfile });
  const snug = analyzeFit({
    product: baseTop,
    profile: { ...lightweightProfile, fitPreference: { tops: "snug" } }
  });

  const ALPHA = ["XS", "S", "M", "L", "XL"];
  const regularIdx = ALPHA.indexOf(regular.suggestedSize);
  const snugIdx = ALPHA.indexOf(snug.suggestedSize);
  assert.ok(snugIdx < regularIdx, `Snug fit (${snug.suggestedSize}) should be smaller than regular (${regular.suggestedSize})`);
  assert.ok(snug.ruleSignals.some((s) => s.id === "snug_preference"));
});

// ---------------------------------------------------------------------------
// Scenario 11: Web evidence says "runs small" via evidenceSignals
// ---------------------------------------------------------------------------
test("accuracy: web evidence runs-small signal sizes up", () => {
  const result = analyzeFit({
    product: baseTop,
    profile: lightweightProfile,
    evidenceSignals: [
      {
        signal: "runsSmall",
        type: "runs_small",
        source: "reddit",
        url: "https://reddit.com/r/fashion/example",
        text: "This shirt runs small, size up."
      }
    ]
  });

  assert.equal(result.suggestedSize, "L", "Web runs-small evidence should push size up from M");
  assert.ok(result.ruleSignals.some((s) => s.id === "runs_small"));
});

// ---------------------------------------------------------------------------
// Scenario 12: Contradictory evidence (runs_small + runs_large) → high risk
// ---------------------------------------------------------------------------
test("accuracy: contradictory sizing signals raise risk and flag contradiction", () => {
  const result = analyzeFit({
    product: baseTop,
    profile: lightweightProfile,
    evidenceSignals: [
      { signal: "runsSmall", type: "runs_small", source: "reddit", url: "", text: "Runs small." },
      { signal: "runsLarge", type: "runs_large", source: "web", url: "", text: "Runs large." }
    ]
  });

  assert.ok(result.riskScore >= 55, `Contradictory evidence should spike risk, got ${result.riskScore}`);
  assert.ok(result.ruleSignals.some((s) => s.id === "contradictory_evidence"));
});

// ---------------------------------------------------------------------------
// Scenario 13: Brand memory "runs small" agrees with product signal → amplified risk
// ---------------------------------------------------------------------------
test("accuracy: brand memory + product signal both say runs-small → high risk, size up", () => {
  const result = analyzeFit({
    product: {
      ...baseTop,
      fitSignals: [{ type: "runs_small", label: "Runs small", text: "Runs small." }]
    },
    profile: lightweightProfile,
    brandMemory: [
      { brand: "Acme", category: "tops", notes: "runs small across all styles", typicalRecommendation: "size up" }
    ]
  });

  // Both signals should push past M → L (and possibly XL via double bias).
  const ALPHA = ["XS", "S", "M", "L", "XL"];
  assert.ok(ALPHA.indexOf(result.suggestedSize) >= ALPHA.indexOf("L"), `Should be at least L, got ${result.suggestedSize}`);
  assert.ok(result.riskScore > 35, `Risk should be elevated, got ${result.riskScore}`);
  assert.ok(result.ruleSignals.some((s) => s.id === "brand_memory_size_up"));
});

// ---------------------------------------------------------------------------
// Scenario 14: Slim-fit language increases risk even without sizing signal
// ---------------------------------------------------------------------------
test("accuracy: slim-fit product language raises risk", () => {
  const baseline = analyzeFit({ product: baseTop, profile: lightweightProfile });
  const slimFit = analyzeFit({
    product: {
      ...baseTop,
      fitSignals: [{ type: "slim_fit", label: "Slim fit", text: "Slim fit." }]
    },
    profile: lightweightProfile
  });

  assert.ok(slimFit.riskScore > baseline.riskScore, `Slim-fit should raise risk above baseline (${baseline.riskScore}), got ${slimFit.riskScore}`);
  assert.ok(slimFit.ruleSignals.some((s) => s.id === "slim_fit"));
});

// ---------------------------------------------------------------------------
// Scenario 15: Result shape is always complete
// ---------------------------------------------------------------------------
test("accuracy: result always has required fields with correct types", () => {
  const result = analyzeFit({ product: baseTop, profile: lightweightProfile });

  assert.ok(typeof result.suggestedSize === "string" && result.suggestedSize.length > 0);
  assert.ok(typeof result.backupSize === "string" && result.backupSize.length > 0);
  assert.ok(typeof result.confidence === "number" && result.confidence >= 0 && result.confidence <= 1);
  assert.ok(typeof result.riskScore === "number" && result.riskScore >= 0 && result.riskScore <= 100);
  assert.ok(typeof result.explanation === "string" && result.explanation.length > 0);
  assert.ok(Array.isArray(result.evidenceSnippets));
  assert.ok(Array.isArray(result.ruleSignals));
  assert.ok(typeof result.timestamp === "string");
});

test("accuracy: exact shoe mode, foot length=27.5 → chart maps to 9.5", () => {
  const result = analyzeFit({
    product: shoeProduct,
    profile: {
      mode: "exact",
      usualSizes: { shoes: "EU 43" },
      fitPreference: { shoes: "regular" },
      measurements: { footLength: "27.5" }
    }
  });

  assert.equal(result.suggestedSize, "9.5");
  assert.ok(result.ruleSignals.some((signal) => signal.id === "measurement_chart_match"));
});
