import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeFit } from "../src/backend/recommendation-engine.js";
import { buildAnalysisPrompt } from "../src/backend/prompt-builder.js";

const baseProfile = {
  mode: "lightweight",
  usualSizes: { tops: "M", bottoms: "28" },
  fitPreference: { tops: "regular", bottoms: "regular" },
  measurements: {}
};

const topProduct = {
  url: "https://shop.example/top",
  brand: "Acme",
  title: "Cotton Shirt",
  category: "tops",
  sizeOptions: ["S", "M", "L", "XL"],
  sizeChart: {
    sourceText: "Size chart",
    tables: [
      {
        caption: "",
        columns: ["Size", "Chest"],
        rows: [
          { Size: "S", Chest: "36" },
          { Size: "M", Chest: "40" },
          { Size: "L", Chest: "44" }
        ]
      }
    ]
  },
  fitSignals: [],
  extractedSignals: { missingFields: [] }
};

test("rules bias up for relaxed preference and runs-small evidence", () => {
  const analysis = analyzeFit({
    product: {
      ...topProduct,
      fitSignals: [{ type: "runs_small", label: "Runs small", text: "Runs small." }]
    },
    profile: {
      ...baseProfile,
      fitPreference: { tops: "relaxed", bottoms: "regular" }
    }
  });

  assert.equal(analysis.suggestedSize, "XL");
  assert.ok(analysis.riskScore > 30);
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "runs_small"));
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "relaxed_preference"));
});

test("rules reduce risk for true-to-size brand memory", () => {
  const analysis = analyzeFit({
    product: topProduct,
    profile: baseProfile,
    brandMemory: [
      {
        brand: "Acme",
        category: "tops",
        notes: "true to size",
        typicalRecommendation: "buy usual size"
      }
    ]
  });

  assert.equal(analysis.suggestedSize, "M");
  assert.ok(analysis.riskScore < 30);
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "brand_memory_true_to_size"));
});

test("rules use exact measurements against size chart", () => {
  const analysis = analyzeFit({
    product: topProduct,
    profile: {
      ...baseProfile,
      mode: "exact",
      measurements: { chestBust: "41" }
    }
  });

  assert.equal(analysis.suggestedSize, "L");
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "measurement_chart_match"));
});

test("rules raise risk for missing charts and prior bad outcomes", () => {
  const analysis = analyzeFit({
    product: {
      ...topProduct,
      sizeChart: { sourceText: "", tables: [] }
    },
    profile: baseProfile,
    history: [
      {
        product: { brand: "Acme", title: "Cotton Shirt" },
        outcome: "returned"
      }
    ]
  });

  assert.ok(analysis.riskScore >= 60);
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "missing_size_chart"));
  assert.ok(analysis.ruleSignals.some((signal) => signal.id === "prior_bad_outcomes"));
});

test("web evidence changes risk and appears in evidence snippets", () => {
  const analysis = analyzeFit({
    product: topProduct,
    profile: baseProfile,
    webEvidence: {
      status: "ok",
      summary: ["2 sources suggest sizing up or that it runs small."],
      snippets: [
        {
          source: "reddit",
          url: "https://reddit.com/example",
          snippet: "This shirt runs small."
        }
      ]
    },
    evidenceSignals: [
      {
        signal: "runsSmall",
        type: "runs_small",
        source: "reddit",
        url: "https://reddit.com/example",
        text: "This shirt runs small."
      }
    ]
  });

  assert.equal(analysis.suggestedSize, "L");
  assert.ok(analysis.riskScore > 30);
  assert.ok(analysis.evidenceSnippets.some((snippet) => snippet.includes("Reddit")));
  assert.ok(analysis.evidenceSnippets.some((snippet) => snippet.includes("sizing up")));
});

test("prompt builder requests strict JSON and includes context", () => {
  const prompt = buildAnalysisPrompt({
    product: topProduct,
    profile: baseProfile,
    brandMemory: [],
    history: [],
    evidenceSignals: []
  });

  assert.match(prompt.system, /Do not invent/i);
  assert.match(prompt.user, /Return strict JSON only/i);
  assert.match(prompt.user, /Cotton Shirt/);
  assert.match(prompt.user, /suggestedSize/);
});
