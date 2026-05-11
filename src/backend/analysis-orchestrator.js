import { gatherEvidence } from "./evidence-service.js";
import { analyzeFit } from "./recommendation-engine.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { callModel } from "./model-service.js";
import { ANALYSIS_MODE_IDS } from "../shared/config.js";

export function resolveMode(payload) {
  const requested = payload.options?.analysisMode || process.env.FITCHECK_ANALYSIS_MODE || "rules_only";
  if (ANALYSIS_MODE_IDS.includes(requested)) return requested;
  return "rules_only";
}

export async function runAnalysis(payload) {
  const mode = resolveMode(payload);

  const useWeb = mode === "rules_plus_web"
    || mode === "model_assisted"
    || Boolean(payload.options?.webEvidenceEnabled);

  const webEvidence = payload.webEvidence || await gatherEvidence(payload.product, {
    enabled: useWeb,
    provider: payload.options?.searchProvider || process.env.FITCHECK_SEARCH_PROVIDER || "firecrawl"
  });

  const evidenceSignals = payload.evidenceSignals || [
    ...mockEvidenceSignals(payload.product),
    ...(webEvidence.signals || [])
  ];

  const rulesResult = analyzeFit({
    product: payload.product,
    profile: payload.profile,
    brandMemory: payload.brandMemory || [],
    history: payload.history || [],
    evidenceSignals,
    webEvidence
  });

  const prompt = buildAnalysisPrompt({
    product: payload.product,
    profile: payload.profile,
    brandMemory: payload.brandMemory || [],
    history: payload.history || [],
    evidenceSignals,
    rulesResult
  });

  const ai = { mode, prompt };

  if (mode === "model_assisted") {
    const modelResult = await callModel(prompt, {
      geminiApiKey: payload.options?.geminiApiKey || ""
    });

    ai.model = {
      provider: "gemini",
      model: "gemini-2.5-flash",
      status: modelResult.status,
      reason: modelResult.reason
    };

    if (modelResult.status === "ok" && modelResult.output) {
      ai.model.output = modelResult.output;

      // Merge model output into the result — override rules engine fields that
      // the model populated, fall back to rules values for any it left blank.
      const out = modelResult.output;
      return {
        ...rulesResult,
        ...(out.suggestedSize ? { suggestedSize: out.suggestedSize } : {}),
        ...(out.backupSize ? { backupSize: out.backupSize } : {}),
        ...(typeof out.confidence === "number" ? { confidence: out.confidence } : {}),
        ...(typeof out.riskScore === "number" ? { riskScore: out.riskScore } : {}),
        ...(out.explanation ? { explanation: out.explanation } : {}),
        ...(Array.isArray(out.evidenceSnippets) && out.evidenceSnippets.length
          ? { evidenceSnippets: out.evidenceSnippets }
          : {}),
        ...(Array.isArray(out.ruleSignals) && out.ruleSignals.length
          ? { ruleSignals: out.ruleSignals }
          : {}),
        webEvidence,
        ai
      };
    }
  }

  return { ...rulesResult, webEvidence, ai };
}

function mockEvidenceSignals(product) {
  return (product.fitSignals || []).map((signal) => ({
    type: signal.type,
    source: "product_page",
    text: signal.text
  }));
}
