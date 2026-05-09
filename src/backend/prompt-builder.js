export function buildAnalysisPrompt({ product, profile, brandMemory = [], history = [], evidenceSignals = [] }) {
  const responseShape = {
    suggestedSize: "string",
    backupSize: "string",
    confidence: "number between 0 and 1",
    riskScore: "integer between 0 and 100",
    explanation: "short direct shopping recommendation",
    evidenceSnippets: ["short evidence strings"],
    ruleSignals: [{ id: "string", impact: "number", message: "string" }],
    timestamp: "ISO-8601 string"
  };

  return {
    system:
      "You are Fitcheck's sizing analyst. Use only the provided product, profile, brand memory, history, and evidence context. Do not invent measurements, reviews, or brand claims. If evidence is insufficient, lower confidence and say what is missing.",
    user: [
      "Return strict JSON only. No markdown, comments, or extra text.",
      `Required JSON shape: ${JSON.stringify(responseShape)}`,
      `Product: ${JSON.stringify(product)}`,
      `User profile: ${JSON.stringify(profile)}`,
      `Brand memory: ${JSON.stringify(brandMemory)}`,
      `History: ${JSON.stringify(history)}`,
      `Evidence signals: ${JSON.stringify(evidenceSignals)}`
    ].join("\n")
  };
}
