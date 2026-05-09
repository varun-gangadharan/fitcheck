export function createMockAnalysis(product, profile) {
  const category = product.category === "bottoms" ? "bottoms" : "tops";
  const preferredSize = profile.usualSizes?.[category] || "M";
  const relaxed = profile.fitPreference?.[category] === "relaxed";
  const missingCount = product.extractedSignals?.missingFields?.length || 0;
  const evidenceCount = [
    product.sizeOptions?.length > 0,
    product.sizeChart?.tables?.length > 0 || product.sizeChart?.sourceText,
    product.fabricComposition,
    product.returnPolicy,
    product.fitSignals?.length > 0
  ].filter(Boolean).length;
  const confidence = Math.max(0.22, Math.min(0.78, 0.28 + evidenceCount * 0.1 - missingCount * 0.02));
  const riskScore = Math.min(88, Math.max(18, 58 - evidenceCount * 5 + missingCount * 4));
  const fitSignalText = product.fitSignals?.map((signal) => signal.label).join(", ");

  return {
    suggestedSize: preferredSize,
    backupSize: relaxed ? sizeUp(preferredSize) : preferredSize,
    confidence,
    riskScore,
    explanation:
      "Mock recommendation based on your saved profile and the visible product details extracted from this page.",
    evidenceSnippets: [
      `Detected ${product.sizeOptions?.length || 0} visible size option${product.sizeOptions?.length === 1 ? "" : "s"}.`,
      product.sizeChart?.tables?.length
        ? `Converted ${product.sizeChart.tables.length} visible size chart table${product.sizeChart.tables.length === 1 ? "" : "s"} into structured data.`
        : "No structured size chart table was detected.",
      fitSignalText ? `Visible fit signals: ${fitSignalText}.` : "No generic fit-language signals were visible.",
      "Live Reddit and web search evidence is not connected yet."
    ].filter(Boolean),
    createdAt: new Date().toISOString()
  };
}

function sizeUp(size) {
  const alpha = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
  const index = alpha.indexOf(String(size).toUpperCase());

  if (index >= 0) {
    return alpha[Math.min(index + 1, alpha.length - 1)];
  }

  const numeric = Number.parseInt(size, 10);
  if (Number.isFinite(numeric)) {
    return String(numeric + 2);
  }

  return size;
}
