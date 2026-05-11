export function buildAnalysisPrompt({ product, profile, brandMemory = [], history = [], evidenceSignals = [], rulesResult = null }) {
  const responseShape = {
    suggestedSize: "string — the single best size to order",
    backupSize: "string — second-best size if the first sells out",
    confidence: "number between 0 and 1",
    riskScore: "integer between 0 and 100",
    explanation: "1-2 sentence direct shopping recommendation mentioning the suggested size",
    evidenceSnippets: ["short strings — key evidence behind this decision"],
    ruleSignals: [{ id: "string", impact: "number", message: "string" }],
    timestamp: "ISO-8601 string"
  };

  const sections = [
    "Return strict JSON only. No markdown, comments, or extra text.",
    `Required JSON shape: ${JSON.stringify(responseShape)}`,
    "",
    "## Task",
    "A rules engine has produced an initial sizing recommendation (below). Review it against all available evidence.",
    "If the evidence strongly supports a different conclusion, override the rules result.",
    "If evidence is weak or contradictory, keep the rules result but lower confidence and explain the uncertainty.",
    "Never invent measurements, reviews, or brand claims not present in the provided data.",
    "",
    `## Rules engine baseline\n${rulesResult ? JSON.stringify(rulesResult) : "not available"}`,
    "",
    `## Product\n${JSON.stringify(product)}`,
    `## User profile\n${JSON.stringify(profile)}`,
    `## Brand memory\n${JSON.stringify(brandMemory)}`,
    `## Purchase history\n${JSON.stringify(history)}`,
    `## Evidence signals\n${JSON.stringify(evidenceSignals)}`
  ];

  return {
    system:
      "You are Fitcheck's sizing analyst. Your job is to verify or improve a rules-based sizing recommendation using all available evidence. Be concise, direct, and honest about uncertainty. Do not hallucinate evidence.",
    user: sections.join("\n")
  };
}
