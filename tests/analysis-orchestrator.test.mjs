import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMode, runAnalysis } from "../src/backend/analysis-orchestrator.js";

const basePayload = {
  product: {
    url: "https://shop.example/top",
    brand: "Acme",
    title: "Cotton Shirt",
    category: "tops",
    sizeOptions: ["S", "M", "L", "XL"],
    sizeChart: { sourceText: "Size chart", tables: [] },
    fitSignals: [],
    extractedSignals: { missingFields: [] }
  },
  profile: {
    mode: "lightweight",
    usualSizes: { tops: "M", bottoms: "30" },
    fitPreference: { tops: "regular", bottoms: "regular" },
    measurements: {}
  }
};

test("resolveMode defaults to rules_only with no options", () => {
  assert.equal(resolveMode({}), "rules_only");
});

test("resolveMode respects payload option", () => {
  assert.equal(resolveMode({ options: { analysisMode: "rules_plus_web" } }), "rules_plus_web");
  assert.equal(resolveMode({ options: { analysisMode: "model_assisted" } }), "model_assisted");
});

test("resolveMode falls back for invalid mode", () => {
  assert.equal(resolveMode({ options: { analysisMode: "bogus" } }), "rules_only");
});

test("resolveMode reads FITCHECK_ANALYSIS_MODE env var", () => {
  const prev = process.env.FITCHECK_ANALYSIS_MODE;
  process.env.FITCHECK_ANALYSIS_MODE = "rules_plus_web";
  try {
    assert.equal(resolveMode({}), "rules_plus_web");
  } finally {
    if (prev === undefined) delete process.env.FITCHECK_ANALYSIS_MODE;
    else process.env.FITCHECK_ANALYSIS_MODE = prev;
  }
});

test("rules_only mode returns analysis with ai.mode set", async () => {
  const result = await runAnalysis(basePayload);

  assert.equal(result.ai.mode, "rules_only");
  assert.ok(result.suggestedSize);
  assert.ok(result.ai.prompt);
  assert.equal(result.ai.model, undefined);
});

test("rules_plus_web mode enables web evidence gathering", async () => {
  const result = await runAnalysis({
    ...basePayload,
    options: { analysisMode: "rules_plus_web" }
  });

  assert.equal(result.ai.mode, "rules_plus_web");
  assert.ok(result.webEvidence);
  assert.equal(result.ai.model, undefined);
});

test("model_assisted mode without API key returns graceful fallback", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const result = await runAnalysis({
      ...basePayload,
      options: { analysisMode: "model_assisted", geminiApiKey: "" }
    });

    assert.equal(result.ai.mode, "model_assisted");
    assert.equal(result.ai.model.status, "no_api_key");
    assert.ok(result.ai.model.reason.includes("not configured"));
    assert.ok(result.suggestedSize);
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
});

test("model_assisted mode with bad key returns api_error without crashing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    text: async () => "Unauthorized"
  });

  try {
    const result = await runAnalysis({
      ...basePayload,
      options: { analysisMode: "model_assisted", geminiApiKey: "bad-key" }
    });

    assert.equal(result.ai.mode, "model_assisted");
    assert.equal(result.ai.model.status, "api_error");
    assert.ok(result.suggestedSize);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("model_assisted mode with successful model call includes output", async () => {
  const originalFetch = globalThis.fetch;
  const modelOutput = { suggestedSize: "L", confidence: 0.85 };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(modelOutput) }] }
      }]
    })
  });

  try {
    const result = await runAnalysis({
      ...basePayload,
      options: { analysisMode: "model_assisted", geminiApiKey: "test-key" }
    });

    assert.equal(result.ai.mode, "model_assisted");
    assert.equal(result.ai.model.status, "ok");
    assert.deepEqual(result.ai.model.output, modelOutput);
    assert.ok(result.suggestedSize);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("response is backwards-compatible with rules_only output shape", async () => {
  const result = await runAnalysis(basePayload);

  assert.ok(typeof result.suggestedSize === "string");
  assert.ok(typeof result.backupSize === "string");
  assert.ok(typeof result.confidence === "number");
  assert.ok(typeof result.riskScore === "number");
  assert.ok(typeof result.explanation === "string");
  assert.ok(Array.isArray(result.evidenceSnippets));
  assert.ok(Array.isArray(result.ruleSignals));
  assert.ok(typeof result.ai === "object");
  assert.ok(typeof result.ai.mode === "string");
  assert.ok(typeof result.ai.prompt === "object");
});
