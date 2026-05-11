import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_CACHE_DIR = ".fitcheck-cache";

/**
 * Creates a file-backed store for evidence cache and rate-limit state.
 * Reads and writes two JSON files inside `dirPath`:
 *   evidence-cache.json   – keyed evidence results with cachedAt timestamps
 *   rate-limit.json       – per-provider arrays of recent search timestamps
 *
 * Both read and write are graceful: missing or corrupt files produce empty
 * defaults; write failures are logged and swallowed.
 */
export function createStore(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
  } catch (_error) {
    // Directory already exists or cannot be created — handled at write time.
  }

  function readJson(filename, fallback) {
    try {
      const raw = readFileSync(join(dirPath, filename), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fallback;
      }
      return parsed;
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(filename, data) {
    try {
      writeFileSync(join(dirPath, filename), JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      console.warn(`[fitcheck] cache write failed (${filename}): ${error.message}`);
    }
  }

  return {
    readCache() {
      return readJson("evidence-cache.json", {});
    },
    writeCache(entries) {
      writeJson("evidence-cache.json", entries);
    },
    readRateLimit() {
      return readJson("rate-limit.json", {});
    },
    writeRateLimit(byProvider) {
      writeJson("rate-limit.json", byProvider);
    }
  };
}

/** No-op store used as the default when `initEvidenceStore` has not been called. */
export function createNullStore() {
  return {
    readCache: () => ({}),
    writeCache: () => {},
    readRateLimit: () => ({}),
    writeRateLimit: () => {}
  };
}
