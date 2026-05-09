import { DEFAULT_PROFILE, STORAGE_KEYS } from "./models.js";

function chromeStorageArea() {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error("chrome.storage.local is unavailable in this context.");
  }

  return globalThis.chrome.storage.local;
}

export async function getValue(key, fallbackValue) {
  const values = await chromeStorageArea().get(key);
  return values[key] ?? fallbackValue;
}

export async function setValue(key, value) {
  await chromeStorageArea().set({ [key]: value });
  return value;
}

export async function getUserProfile() {
  return getValue(STORAGE_KEYS.userProfile, DEFAULT_PROFILE);
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
  return nextRecord;
}

export async function clearHistory() {
  return setValue(STORAGE_KEYS.history, []);
}
