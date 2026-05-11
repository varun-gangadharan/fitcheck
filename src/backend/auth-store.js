/**
 * Token registry — persisted to .fitcheck-cache/tokens.json.
 *
 * Schema per token:
 *   { label, createdAt, lastUsedAt, active, usage: { total, today, todayDate,
 *     aiCallsToday, aiCallsDate } }
 *
 * Tokens are keyed by the token string itself for O(1) lookup.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

function tokensFile() {
  const dir = process.env.FITCHECK_CACHE_DIR
    ? process.env.FITCHECK_CACHE_DIR
    : join(process.cwd(), ".fitcheck-cache");
  mkdirSync(dir, { recursive: true });
  return join(dir, "tokens.json");
}

function load() {
  try {
    return JSON.parse(readFileSync(tokensFile(), "utf8"));
  } catch {
    return {};
  }
}

function save(tokens) {
  writeFileSync(tokensFile(), JSON.stringify(tokens, null, 2), "utf8");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Create a new token and persist it. Returns the raw token string. */
export function createToken(label) {
  if (!label || !label.trim()) throw new Error("Label is required.");
  const tokens = load();
  const token = `fck_${randomBytes(24).toString("hex")}`;
  tokens[token] = {
    label: label.trim(),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    active: true,
    usage: { total: 0, today: 0, todayDate: "", aiCallsToday: 0, aiCallsDate: "" }
  };
  save(tokens);
  return token;
}

/** Return all token records as an array (token value included in each object). */
export function listTokens() {
  return Object.entries(load()).map(([token, record]) => ({ token, ...record }));
}

/** Deactivate a token. Returns true if found, false if not. */
export function revokeToken(token) {
  const tokens = load();
  if (!tokens[token]) return false;
  tokens[token].active = false;
  save(tokens);
  return true;
}

/**
 * Validate a raw token string.
 * Returns the full record (with `token` key) if valid and active, or null.
 */
export function validateToken(rawToken) {
  if (!rawToken || !rawToken.startsWith("fck_")) return null;
  const record = load()[rawToken];
  if (!record || !record.active) return null;
  return { token: rawToken, ...record };
}

/**
 * Increment usage counters for a token after a successful request.
 * Resets daily counters automatically when the date changes.
 */
export function recordUsage(rawToken, { isAiCall = false } = {}) {
  const tokens = load();
  const record = tokens[rawToken];
  if (!record) return;

  const d = today();
  record.lastUsedAt = new Date().toISOString();
  record.usage.total = (record.usage.total || 0) + 1;

  if (record.usage.todayDate !== d) {
    record.usage.today = 0;
    record.usage.todayDate = d;
  }
  record.usage.today = (record.usage.today || 0) + 1;

  if (isAiCall) {
    if (record.usage.aiCallsDate !== d) {
      record.usage.aiCallsToday = 0;
      record.usage.aiCallsDate = d;
    }
    record.usage.aiCallsToday = (record.usage.aiCallsToday || 0) + 1;
  }

  save(tokens);
}
