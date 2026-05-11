import { CURRENT_SCHEMA_VERSION, DEFAULT_PROFILE, EMPTY_BRAND_NOTE, STORAGE_KEYS } from "./models.js";
import { DEFAULT_CONFIG } from "./config.js";

function chromeStorageArea() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable in this context.");
  }

  return globalThis.chrome.storage.local;
}

export async function getValue(key, fallbackValue) {
  await ensureStorageMigrated();
  const values = await chromeStorageArea().get(key);
  return values[key] ?? fallbackValue;
}

export async function setValue(key, value) {
  await ensureStorageMigrated();
  await chromeStorageArea().set({ [key]: value });
  return value;
}

export async function ensureStorageMigrated() {
  if (ensureStorageMigrated.running) return ensureStorageMigrated.running;

  ensureStorageMigrated.running = migrateStorage().finally(() => {
    ensureStorageMigrated.running = null;
  });
  return ensureStorageMigrated.running;
}

export async function getUserProfile() {
  return getValue(STORAGE_KEYS.userProfile, DEFAULT_PROFILE);
}

export async function getConfig() {
  return getValue(STORAGE_KEYS.config, DEFAULT_CONFIG);
}

export async function saveConfig(config) {
  return setValue(STORAGE_KEYS.config, {
    ...DEFAULT_CONFIG,
    ...config,
    apiUrl: String(config.apiUrl || DEFAULT_CONFIG.apiUrl).replace(/\/+$/, ""),
    apiToken: String(config.apiToken || "").trim(),
    analysisMode: config.analysisMode || DEFAULT_CONFIG.analysisMode,
    webEvidenceEnabled: Boolean(config.webEvidenceEnabled),
    searchProvider: config.searchProvider || DEFAULT_CONFIG.searchProvider,
    // geminiApiKey is intentionally excluded — it lives in the server's env only
  });
}

export async function saveUserProfile(profile) {
  return setValue(STORAGE_KEYS.userProfile, {
    ...profile,
    updatedAt: new Date().toISOString()
  });
}

export async function getBrandNotes() {
  return getValue(STORAGE_KEYS.brandNotes, []);
}

export async function saveBrandNotes(brandNotes) {
  return setValue(STORAGE_KEYS.brandNotes, brandNotes);
}

export async function upsertBrandNote(note) {
  const brandNotes = await getBrandNotes();
  const index = brandNotes.findIndex((candidate) =>
    sameText(candidate.brand, note.brand) && (candidate.category || "unknown") === (note.category || "unknown")
  );
  const next = {
    ...EMPTY_BRAND_NOTE,
    ...(index >= 0 ? brandNotes[index] : {}),
    ...note,
    updatedAt: new Date().toISOString()
  };

  if (index >= 0) {
    brandNotes[index] = next;
  } else {
    brandNotes.unshift(next);
  }

  await saveBrandNotes(brandNotes);
  return next;
}

export async function getHistory() {
  return getValue(STORAGE_KEYS.history, []);
}

export async function addHistoryRecord(record) {
  const history = await getHistory();
  const nextRecord = {
    ...record,
    id: record.id ?? crypto.randomUUID(),
    timestamp: record.timestamp ?? new Date().toISOString()
  };

  await setValue(STORAGE_KEYS.history, [nextRecord, ...history].slice(0, 50));
  if (record.analysis) {
    await addAnalysisResult(nextRecord);
  }
  return nextRecord;
}

export async function getAnalysisResults() {
  return getValue(STORAGE_KEYS.analysisResults, []);
}

export async function addAnalysisResult(record) {
  const results = await getAnalysisResults();
  const result = {
    id: record.id ?? crypto.randomUUID(),
    product: record.product,
    analysis: record.analysis,
    outcome: record.outcome ?? null,
    note: record.note || "",
    timestamp: record.timestamp ?? new Date().toISOString()
  };

  await setValue(STORAGE_KEYS.analysisResults, [result, ...results].slice(0, 50));
  return result;
}

export async function updateBrandMemoryFromOutcome(record) {
  const product = record.product || {};
  if (!product.brand) {
    return null;
  }

  const note = await upsertBrandNote({
    brand: product.brand,
    category: product.category || "unknown"
  });
  const counts = {
    ...EMPTY_BRAND_NOTE.outcomeCounts,
    ...(note.outcomeCounts || {})
  };
  if (record.outcome && counts[record.outcome] !== undefined) {
    counts[record.outcome] += 1;
  }

  const typicalRecommendation = recommendationFromOutcome(record.outcome, note.typicalRecommendation);
  const noteText = record.note
    ? [note.notes, record.note].filter(Boolean).join(" | ")
    : note.notes;

  // Update numeric bias from this outcome. Bias accumulates across orders
  // and is used by the recommendation engine to adjust size suggestions.
  const bias = computeUpdatedBias(note.bias ?? 0, record.outcome);

  return upsertBrandNote({
    ...note,
    lastOutcome: record.outcome || note.lastOutcome || "",
    outcomeCounts: counts,
    typicalRecommendation,
    bias,
    notes: noteText
  });
}

/**
 * Compute new bias value [-2, 2] from the previous bias and the latest outcome.
 *
 *   too_small  → +0.5  (need to go up)
 *   too_big    → -0.5  (need to go down)
 *   returned   → reinforce current direction by +0.3 (returns signal sustained discomfort)
 *   fit        → nudge 0.2 toward 0 (good outcome, reduce extremity)
 */
function computeUpdatedBias(currentBias, outcome) {
  let delta = 0;
  if (outcome === "too_small") delta = 0.5;
  else if (outcome === "too_big") delta = -0.5;
  else if (outcome === "returned") delta = currentBias > 0 ? 0.3 : currentBias < 0 ? -0.3 : 0;
  else if (outcome === "fit") delta = currentBias > 0 ? -0.2 : currentBias < 0 ? 0.2 : 0;
  return Math.max(-2, Math.min(2, (currentBias || 0) + delta));
}

export async function clearHistory() {
  await setValue(STORAGE_KEYS.analysisResults, []);
  return setValue(STORAGE_KEYS.history, []);
}

async function migrateStorage() {
  const storage = chromeStorageArea();
  const values = await storage.get([
    STORAGE_KEYS.schemaVersion,
    STORAGE_KEYS.brandNotes,
    STORAGE_KEYS.history,
    STORAGE_KEYS.analysisResults
  ]);
  const version = values[STORAGE_KEYS.schemaVersion] || 1;

  if (version >= CURRENT_SCHEMA_VERSION) return;

  const brandNotes = (values[STORAGE_KEYS.brandNotes] || []).map((note) => ({
    ...EMPTY_BRAND_NOTE,
    ...note,
    outcomeCounts: {
      ...EMPTY_BRAND_NOTE.outcomeCounts,
      ...(note.outcomeCounts || {})
    },
    // v3: ensure numeric bias field exists
    bias: typeof note.bias === "number" ? note.bias : 0
  }));
  const history = values[STORAGE_KEYS.history] || [];
  const analysisResults = values[STORAGE_KEYS.analysisResults] || history
    .filter((record) => record.analysis)
    .map((record) => ({
      id: record.id || crypto.randomUUID(),
      product: record.product,
      analysis: record.analysis,
      outcome: record.outcome ?? null,
      note: record.note || "",
      timestamp: record.timestamp || new Date().toISOString()
    }));

  await storage.set({
    [STORAGE_KEYS.schemaVersion]: CURRENT_SCHEMA_VERSION,
    [STORAGE_KEYS.brandNotes]: brandNotes,
    [STORAGE_KEYS.analysisResults]: analysisResults
  });
}

function recommendationFromOutcome(outcome, fallback) {
  if (outcome === "too_small") return "size up";
  if (outcome === "too_big") return "size down";
  if (outcome === "fit") return "true to size";
  if (outcome === "returned") return "high risk";
  return fallback || "";
}

function sameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}
