const ALPHA_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function analyzeFit({ product, profile, brandMemory = [], history = [], evidenceSignals = [], webEvidence = null }) {
  const category = product.category === "bottoms" ? "bottoms" : "tops";
  const chartSize = chooseSizeFromChart(product, profile, category);
  const usualSize = profile.usualSizes?.[category] || profile.usualSizes?.tops || "M";
  const baseSize = chartSize || nearestAvailableSize(usualSize, product.sizeOptions) || usualSize;
  const signals = buildSignals({ product, profile, brandMemory, history, evidenceSignals, webEvidence, chartSize });
  const suggestedSize = applySizeBias(baseSize, product.sizeOptions, signals.bias);
  const backupSize = chooseBackupSize(suggestedSize, product.sizeOptions, signals.bias);
  const riskScore = clamp(signals.risk, 5, 95);
  const confidence = Number(clamp(0.92 - riskScore / 140, 0.22, 0.86).toFixed(2));

  return {
    suggestedSize,
    backupSize,
    confidence,
    riskScore,
    explanation: buildExplanation(product, suggestedSize, backupSize, signals),
    evidenceSnippets: buildEvidenceSnippets(product, signals),
    ruleSignals: signals.ruleSignals,
    timestamp: new Date().toISOString()
  };
}

function buildSignals({ product, profile, brandMemory, history, evidenceSignals, webEvidence, chartSize }) {
  let risk = 30;
  let bias = 0;
  const ruleSignals = [];
  const fitSignalTypes = new Set(normalizeSignalTypes([
    ...(product.fitSignals || []).map((signal) => signal.type),
    ...evidenceSignals.flatMap((signal) => [signal.type, signal.signal])
  ]));
  const relevantBrandNotes = brandMemory.filter((note) =>
    sameText(note.brand, product.brand) && (!note.category || note.category === product.category || note.category === "unknown")
  );
  const relevantHistory = history.filter((record) =>
    sameText(record.product?.brand, product.brand) || sameText(record.product?.title, product.title)
  );

  if (!product.sizeChart?.tables?.length && !product.sizeChart?.sourceText) {
    risk += 22;
    ruleSignals.push(rule("missing_size_chart", 22, "No visible size chart was extracted."));
  } else if ((product.sizeChart?.tables?.[0]?.rows?.length || 0) < 2) {
    risk += 10;
    ruleSignals.push(rule("sparse_size_chart", 10, "Size chart data is sparse."));
  } else {
    risk -= 6;
    ruleSignals.push(rule("structured_size_chart", -6, "Structured size chart data is available."));
  }

  if (chartSize) {
    risk -= 8;
    ruleSignals.push(rule("measurement_chart_match", -8, `Measurements map to ${chartSize}.`));
  }

  if (fitSignalTypes.has("runs_small")) {
    risk += 12;
    bias += 1;
    ruleSignals.push(rule("runs_small", 12, "Extracted evidence says this may run small."));
  }

  if (fitSignalTypes.has("runs_large")) {
    risk += 12;
    bias -= 1;
    ruleSignals.push(rule("runs_large", 12, "Extracted evidence says this may run large."));
  }

  if (fitSignalTypes.has("true_to_size")) {
    risk -= 10;
    ruleSignals.push(rule("true_to_size", -10, "Evidence says this is true to size."));
  }

  if (fitSignalTypes.has("runs_small") && fitSignalTypes.has("runs_large")) {
    risk += 18;
    ruleSignals.push(rule("contradictory_evidence", 18, "Evidence is contradictory."));
  }

  if (fitSignalTypes.has("inconsistent")) {
    risk += 16;
    ruleSignals.push(rule("inconsistent_evidence", 16, "Web evidence is inconsistent."));
  }

  if (fitSignalTypes.has("insufficient_evidence") || webEvidence?.status === "not_configured") {
    risk += 4;
    ruleSignals.push(rule("insufficient_web_evidence", 4, webEvidence?.reason || "Web evidence is unavailable."));
  }

  if (fitSignalTypes.has("slim_fit")) {
    risk += 6;
    if (profile.fitPreference?.[product.category] !== "snug") bias += 1;
    ruleSignals.push(rule("slim_fit", 6, "Slim-fit language increases fit risk."));
  }

  if (fitSignalTypes.has("relaxed_fit") || fitSignalTypes.has("oversized")) {
    risk -= 4;
    ruleSignals.push(rule("relaxed_or_oversized", -4, "Relaxed or oversized fit language lowers precision risk."));
  }

  const preference = profile.fitPreference?.[product.category] || profile.fitPreference?.tops;
  if (preference === "relaxed") {
    bias += 1;
    ruleSignals.push(rule("relaxed_preference", 0, "User prefers a relaxed fit, biasing up."));
  }
  if (preference === "snug") {
    bias -= 1;
    ruleSignals.push(rule("snug_preference", 0, "User prefers a snug fit, biasing down."));
  }

  for (const note of relevantBrandNotes) {
    const text = `${note.typicalRecommendation || ""} ${note.notes || ""}`.toLowerCase();
    if (/run small|runs small|size up|up/.test(text)) {
      risk += 8;
      bias += 1;
      ruleSignals.push(rule("brand_memory_size_up", 8, "Brand memory suggests sizing up."));
    }
    if (/run large|runs large|size down|down/.test(text)) {
      risk += 8;
      bias -= 1;
      ruleSignals.push(rule("brand_memory_size_down", 8, "Brand memory suggests sizing down."));
    }
    if (/true to size|tts/.test(text)) {
      risk -= 7;
      ruleSignals.push(rule("brand_memory_true_to_size", -7, "Brand memory says true to size."));
    }
  }

  const badOutcomes = relevantHistory.filter((record) =>
    ["too_small", "too_big", "returned"].includes(record.outcome)
  );
  if (badOutcomes.length) {
    risk += Math.min(24, badOutcomes.length * 12);
    ruleSignals.push(rule("prior_bad_outcomes", Math.min(24, badOutcomes.length * 12), "Prior outcome history raises risk."));
  }

  return { risk, bias: clamp(bias, -2, 2), ruleSignals, webEvidence };
}

function chooseSizeFromChart(product, profile, category) {
  if (profile.mode !== "exact") return "";

  const table = product.sizeChart?.tables?.[0];
  if (!table?.rows?.length) return "";

  const measurement = category === "bottoms"
    ? Number.parseFloat(profile.measurements?.waist)
    : Number.parseFloat(profile.measurements?.chestBust);
  if (!Number.isFinite(measurement)) return "";

  const measureColumn = findColumn(table.columns, category === "bottoms" ? ["waist"] : ["chest", "bust"]);
  const sizeColumn = findColumn(table.columns, ["size"]);
  if (!measureColumn || !sizeColumn) return "";

  const row = table.rows.find((candidate) => measurement <= maxNumber(candidate[measureColumn]));
  return row?.[sizeColumn] || "";
}

function findColumn(columns, names) {
  return columns.find((column) => names.some((name) => column.toLowerCase().includes(name))) || "";
}

function maxNumber(value) {
  const numbers = String(value || "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : Number.POSITIVE_INFINITY;
}

function applySizeBias(size, availableSizes, bias) {
  let next = size;
  const steps = Math.abs(bias);
  for (let index = 0; index < steps; index += 1) {
    next = bias > 0 ? sizeUp(next, availableSizes) : sizeDown(next, availableSizes);
  }
  return next;
}

function chooseBackupSize(suggestedSize, availableSizes, bias) {
  if (bias < 0) return sizeUp(suggestedSize, availableSizes);
  if (bias > 0) return sizeDown(suggestedSize, availableSizes);
  return sizeUp(suggestedSize, availableSizes) || sizeDown(suggestedSize, availableSizes) || suggestedSize;
}

function nearestAvailableSize(size, availableSizes = []) {
  return availableSizes.find((candidate) => sameText(candidate, size)) || "";
}

function sizeUp(size, availableSizes = []) {
  return adjacentSize(size, availableSizes, 1);
}

function sizeDown(size, availableSizes = []) {
  return adjacentSize(size, availableSizes, -1);
}

function adjacentSize(size, availableSizes, direction) {
  const values = availableSizes.length ? availableSizes : ALPHA_SIZES;
  const exactIndex = values.findIndex((candidate) => sameText(candidate, size));
  if (exactIndex >= 0) return values[clamp(exactIndex + direction, 0, values.length - 1)];

  const alphaIndex = ALPHA_SIZES.indexOf(String(size).toUpperCase());
  if (alphaIndex >= 0) return ALPHA_SIZES[clamp(alphaIndex + direction, 0, ALPHA_SIZES.length - 1)];

  const numeric = Number.parseInt(size, 10);
  if (Number.isFinite(numeric)) return String(numeric + direction * 2);

  return size;
}

function buildExplanation(product, suggestedSize, backupSize, signals) {
  const topSignals = signals.ruleSignals.slice(0, 3).map((signal) => signal.message).join(" ");
  return `If you want this ${product.category === "unknown" ? "item" : product.category.slice(0, -1)}, buy ${suggestedSize}. Backup size: ${backupSize}. ${topSignals}`;
}

function buildEvidenceSnippets(product, signals) {
  const snippets = [
    product.sizeChart?.tables?.length
      ? `Size chart table detected with ${product.sizeChart.tables[0].rows.length} rows.`
      : "No structured size chart table detected.",
    product.fitSignals?.length
      ? `Extracted fit language: ${product.fitSignals.map((signal) => signal.label).join(", ")}.`
      : "No visible fit-language signals extracted.",
    ...(signals.webEvidence?.summary || []),
    ...(signals.webEvidence?.snippets || []).slice(0, 3).map((snippet) =>
      `${snippet.source}: ${snippet.snippet}`
    ),
    ...signals.ruleSignals.slice(0, 4).map((signal) => signal.message)
  ];
  return Array.from(new Set(snippets));
}

function normalizeSignalTypes(values) {
  const map = {
    runsSmall: "runs_small",
    runsLarge: "runs_large",
    trueToSize: "true_to_size",
    sizeUp: "runs_small",
    sizeDown: "runs_large",
    inconsistent: "inconsistent",
    insufficientEvidence: "insufficient_evidence"
  };
  return values.filter(Boolean).map((value) => map[value] || value);
}

function rule(id, impact, message) {
  return { id, impact, message };
}

function sameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
