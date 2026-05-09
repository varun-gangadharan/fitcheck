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
    webEvidenceEnabled: Boolean(config.webEvidenceEnabled),
    searchProvider: config.searchProvider || DEFAULT_CONFIG.searchProvider
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

  return upsertBrandNote({
    ...note,
    lastOutcome: record.outcome || note.lastOutcome || "",
    outcomeCounts: counts,
    typicalRecommendation,
    notes: noteText
  });
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
    }
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
