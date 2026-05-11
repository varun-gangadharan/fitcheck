const ALPHA_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
const ONE_SIZE_TOKENS = new Set(["OS", "ONE SIZE", "O/S"]);

export function analyzeFit({ product, profile, brandMemory = [], history = [], evidenceSignals = [], webEvidence = null }) {
  const category = resolveCategory(product.category);
  const chartSize = chooseSizeFromChart(product, profile, category);
  const usualSize = resolveUsualSize(profile, category);
  const baseSize = resolveBaseSize(product, usualSize, chartSize, category);
  const signals = buildSignals({ product, profile, brandMemory, history, evidenceSignals, webEvidence, chartSize, category });
  const suggestedSize = applySizeBias(baseSize, product.sizeOptions, signals.bias);
  const backupSize = chooseBackupSize(suggestedSize, product.sizeOptions, signals.bias);
  const riskScore = clamp(signals.risk, 5, 95);
  const confidence = Number(clamp(0.92 - riskScore / 140, 0.22, 0.86).toFixed(2));

  return {
    suggestedSize,
    backupSize,
    confidence,
    riskScore,
    explanation: buildExplanation(product, suggestedSize, backupSize, signals, category),
    evidenceSnippets: buildEvidenceSnippets(product, signals),
    ruleSignals: signals.ruleSignals,
    timestamp: new Date().toISOString()
  };
}

/** Normalize category to one the engine explicitly handles. */
function resolveCategory(rawCategory) {
  if (rawCategory === "bottoms") return "bottoms";
  if (rawCategory === "shoes") return "shoes";
  if (rawCategory === "accessories") return "accessories";
  return "tops";
}

function buildSignals({ product, profile, brandMemory, history, evidenceSignals, webEvidence, chartSize, category }) {
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
  const priceBand = priceBandForProduct(product.price);

  // ── Size chart quality ──────────────────────────────────────────────────────

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

  // ── Clothing fit signals ────────────────────────────────────────────────────

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
    if (profile.fitPreference?.[category] !== "snug") bias += 1;
    ruleSignals.push(rule("slim_fit", 6, "Slim-fit language increases fit risk."));
  }

  if (fitSignalTypes.has("relaxed_fit") || fitSignalTypes.has("oversized")) {
    risk -= 4;
    ruleSignals.push(rule("relaxed_or_oversized", -4, "Relaxed or oversized fit language lowers precision risk."));
  }

  // ── Shoe-specific signals ───────────────────────────────────────────────────

  if (category === "shoes") {
    if (fitSignalTypes.has("runs_narrow")) {
      risk += 10;
      // Bias up only if user doesn't already prefer narrow fit
      if (profile.fitPreference?.[category] !== "snug") bias += 1;
      ruleSignals.push(rule("runs_narrow", 10, "Evidence says this shoe runs narrow — consider sizing up."));
    }
    if (fitSignalTypes.has("runs_wide")) {
      risk += 8;
      ruleSignals.push(rule("runs_wide", 8, "Evidence says this shoe runs wide — may feel loose."));
    }
    if (fitSignalTypes.has("half_size_up")) {
      risk += 8;
      bias += 1;
      ruleSignals.push(rule("half_size_up", 8, "Evidence recommends going half a size up."));
    }
  }

  // ── Fit preference ──────────────────────────────────────────────────────────

  const preference = profile.fitPreference?.[category] || profile.fitPreference?.tops;
  if (preference === "relaxed") {
    bias += 1;
    ruleSignals.push(rule("relaxed_preference", 0, "User prefers a relaxed fit, biasing up."));
  }
  if (preference === "snug") {
    bias -= 1;
    ruleSignals.push(rule("snug_preference", 0, "User prefers a snug fit, biasing down."));
  }

  // ── Brand memory ────────────────────────────────────────────────────────────

  for (const note of relevantBrandNotes) {
    const numericBias = typeof note.bias === "number" ? note.bias : 0;
    const hasBiasData = Math.abs(numericBias) >= 0.5;

    if (hasBiasData) {
      // Numeric outcome bias takes priority — derived from actual purchase history.
      const biasRounded = numericBias > 0 ? 1 : -1;
      const riskDelta = Math.min(20, Math.round(Math.abs(numericBias) * 8));
      risk += riskDelta;
      bias += biasRounded;
      const counts = note.outcomeCounts || {};
      ruleSignals.push(rule(
        "brand_outcome_bias",
        riskDelta,
        `Past orders for ${product.brand}: ${counts.too_small || 0} too small, ${counts.too_big || 0} too big, ${counts.fit || 0} fit.`
      ));
    } else {
      // Fall back to text-based brand notes when no numeric outcome history yet.
      const text = `${note.typicalRecommendation || ""} ${note.notes || ""}`.toLowerCase();
      if (/run small|runs small|size up/.test(text)) {
        risk += 8;
        bias += 1;
        ruleSignals.push(rule("brand_memory_size_up", 8, "Brand memory suggests sizing up."));
      }
      if (/run large|runs large|size down/.test(text)) {
        risk += 8;
        bias -= 1;
        ruleSignals.push(rule("brand_memory_size_down", 8, "Brand memory suggests sizing down."));
      }
      if (/true to size|tts/.test(text)) {
        risk -= 7;
        ruleSignals.push(rule("brand_memory_true_to_size", -7, "Brand memory says true to size."));
      }
    }
  }

  // ── Purchase history ────────────────────────────────────────────────────────

  const badOutcomes = relevantHistory.filter((record) =>
    ["too_small", "too_big", "returned"].includes(record.outcome)
  );
  if (badOutcomes.length) {
    risk += Math.min(24, badOutcomes.length * 12);
    ruleSignals.push(rule("prior_bad_outcomes", Math.min(24, badOutcomes.length * 12), "Prior outcome history raises risk."));
  }

  if (priceBand === "premium" && risk >= 35) {
    risk += 6;
    ruleSignals.push(rule("premium_price_risk", 6, `This is a higher-priced item (${product.price}), so uncertainty carries more downside.`));
  } else if (priceBand === "budget" && risk <= 25) {
    risk -= 2;
    ruleSignals.push(rule("budget_price_cushion", -2, `The price (${product.price}) is relatively low, which softens the cost of fit risk.`));
  }

  return { risk, bias: clamp(bias, -2, 2), ruleSignals, webEvidence };
}

function chooseSizeFromChart(product, profile, category) {
  if (profile.mode !== "exact") return "";
  const table = product.sizeChart?.tables?.[0];
  if (!table?.rows?.length) return "";

  if (category === "shoes") {
    const footLength = Number.parseFloat(profile.measurements?.footLength);
    if (!Number.isFinite(footLength)) return "";
    const lengthCol = findColumn(table.columns, ["foot length", "length (cm)", "cm", "insole", "length"]);
    const sizeCol = findColumn(table.columns, ["us", "size", "uk", "eu"]);
    if (!lengthCol || !sizeCol) return "";
    const row = table.rows.find((candidate) => footLength <= maxNumber(candidate[lengthCol]));
    return row?.[sizeCol] || "";
  }

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

function resolveUsualSize(profile, category) {
  const exact = profile.usualSizes?.[category];
  if (exact) return exact;
  if (category === "accessories") return "";
  return profile.usualSizes?.tops || "M";
}

function resolveBaseSize(product, usualSize, chartSize, category) {
  if (chartSize) return chartSize;
  if (category === "accessories") {
    return chooseAccessorySize(product) || usualSize || "ONE SIZE";
  }
  if (category === "shoes") {
    return resolveShoeSize(product, usualSize) || nearestAvailableSize(usualSize, product.sizeOptions) || normalizeSize(usualSize) || "9";
  }
  return nearestAvailableSize(usualSize, product.sizeOptions) || normalizeSize(usualSize) || usualSize;
}

function chooseAccessorySize(product) {
  const oneSize = (product.sizeOptions || []).find((size) => ONE_SIZE_TOKENS.has(normalizeSize(size)));
  if (oneSize) return oneSize;
  if ((product.sizeOptions || []).length === 1) return product.sizeOptions[0];
  return "";
}

function resolveShoeSize(product, usualSize) {
  const direct = nearestAvailableSize(usualSize, product.sizeOptions);
  if (direct) return direct;

  const normalized = normalizeSize(usualSize);
  if (!normalized) return "";
  const system = detectSizeSystem(usualSize);
  if (system === "unknown") return nearestAvailableSize(normalized, product.sizeOptions);

  const table = product.sizeChart?.tables?.find((candidate) => candidate?.rows?.length && candidate?.columns?.length);
  if (!table) return nearestAvailableSize(normalized, product.sizeOptions);
  const targetCol = findShoeColumn(table.columns, system);
  const outputCol = findShoeColumn(table.columns, "us") || findColumn(table.columns, ["size"]);
  if (!targetCol || !outputCol) return nearestAvailableSize(normalized, product.sizeOptions);

  const row = table.rows.find((candidate) => sameSize(candidate[targetCol], normalized));
  return row?.[outputCol] || nearestAvailableSize(normalized, product.sizeOptions);
}

function findColumn(columns, names) {
  return columns.find((column) => names.some((name) => column.toLowerCase().includes(name))) || "";
}

function findShoeColumn(columns, system) {
  if (system === "eu") return findColumn(columns, ["eu"]);
  if (system === "uk") return findColumn(columns, ["uk"]);
  return findColumn(columns, ["us"]);
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
  if (!availableSizes?.length) return suggestedSize;
  if (bias < 0) return sizeUp(suggestedSize, availableSizes);
  if (bias > 0) return sizeDown(suggestedSize, availableSizes);
  return sizeUp(suggestedSize, availableSizes) || sizeDown(suggestedSize, availableSizes) || suggestedSize;
}

function nearestAvailableSize(size, availableSizes = []) {
  const normalized = normalizeSize(size);
  return availableSizes.find((candidate) => sameSize(candidate, normalized)) || "";
}

function sizeUp(size, availableSizes = []) {
  return adjacentSize(size, availableSizes, 1);
}

function sizeDown(size, availableSizes = []) {
  return adjacentSize(size, availableSizes, -1);
}

function adjacentSize(size, availableSizes, direction) {
  const values = availableSizes.length ? availableSizes : ALPHA_SIZES;
  const exactIndex = values.findIndex((candidate) => sameSize(candidate, size));
  if (exactIndex >= 0) return values[clamp(exactIndex + direction, 0, values.length - 1)];

  const alphaIndex = ALPHA_SIZES.indexOf(normalizeSize(size));
  if (alphaIndex >= 0) return ALPHA_SIZES[clamp(alphaIndex + direction, 0, ALPHA_SIZES.length - 1)];

  const numeric = Number.parseFloat(size);
  if (Number.isFinite(numeric)) {
    // Half-size step for shoe sizes, full-size step for waist/other numeric
    const step = String(size).includes(".") ? 0.5 : 2;
    return String(numeric + direction * step);
  }

  return size;
}

function buildExplanation(product, suggestedSize, backupSize, signals, category) {
  const categoryLabel = {
    tops: "top",
    bottoms: "bottom",
    shoes: "shoe",
    accessories: "accessory",
    unknown: "item"
  }[category] || "item";

  const topSignals = signals.ruleSignals
    .filter((signal) => !["insufficient_web_evidence"].includes(signal.id))
    .slice(0, 3)
    .map((signal) => signal.message)
    .join(" ");
  return `If you want this ${categoryLabel}, buy ${suggestedSize}. Backup size: ${backupSize}. ${topSignals}`;
}

function buildEvidenceSnippets(product, signals) {
  const snippets = [
    product.sizeChart?.tables?.length
      ? `Size chart found with ${product.sizeChart.tables[0].rows.length} rows.`
      : "No structured size chart table detected.",
    product.fitSignals?.length
      ? `Product page fit language: ${product.fitSignals.map((signal) => signal.label).join(", ")}.`
      : "No visible fit-language signals extracted.",
    ...(signals.webEvidence?.summary || []),
    ...(signals.webEvidence?.snippets || []).slice(0, 3).map((snippet) =>
      `${sourceLabel(snippet.source)}: ${snippet.snippet}`
    ),
    ...signals.ruleSignals
      .filter((signal) => !["insufficient_web_evidence"].includes(signal.id))
      .slice(0, 4)
      .map((signal) => signal.message)
  ];
  return Array.from(new Set(snippets)).filter(Boolean).slice(0, 8);
}

function sourceLabel(source) {
  if (source === "reddit") return "Reddit";
  return source || "Source";
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

function normalizeSize(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:US|EU|UK)\s*/i, "")
    .replace(/^one size$/i, "ONE SIZE")
    .replace(/^o\/s$/i, "OS")
    .toUpperCase();
}

function detectSizeSystem(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw.startsWith("EU")) return "eu";
  if (raw.startsWith("UK")) return "uk";
  if (raw.startsWith("US")) return "us";
  return "unknown";
}

function sameSize(left, right) {
  return normalizeSize(left) === normalizeSize(right);
}

function priceBandForProduct(price) {
  const amount = parsePriceAmount(price);
  if (!Number.isFinite(amount)) return "unknown";
  if (amount >= 150) return "premium";
  if (amount <= 40) return "budget";
  return "mid";
}

function parsePriceAmount(price) {
  const numeric = String(price || "").replace(/[^0-9.]/g, "");
  if (!numeric) return Number.NaN;
  return Number.parseFloat(numeric);
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
