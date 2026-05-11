/**
 * Auth middleware — token validation + layered rate limiting.
 *
 * Rate limits (all configurable via env):
 *   FITCHECK_DAILY_LIMIT     — total requests per token per day  (default 100)
 *   FITCHECK_DAILY_AI_LIMIT  — AI/Gemini calls per token per day (default 20)
 *   FITCHECK_RPM_LIMIT       — requests per token per minute     (default 10)
 *
 * Usage:
 *   const record = checkAuth(req, res, { isAiCall: true });
 *   if (!record) return; // response already sent
 *   // ... do work ...
 *   recordUsage(record.token, { isAiCall: true });
 */

import { validateToken } from "./auth-store.js";

const DAILY_LIMIT = Number.parseInt(process.env.FITCHECK_DAILY_LIMIT || "100", 10);
const DAILY_AI_LIMIT = Number.parseInt(process.env.FITCHECK_DAILY_AI_LIMIT || "20", 10);
const RPM_LIMIT = Number.parseInt(process.env.FITCHECK_RPM_LIMIT || "10", 10);

/** In-memory sliding-window: token → sorted array of request timestamps (ms). */
const minuteWindows = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sendError(response, status, code, message) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: code, message }));
}

/**
 * Validate the Bearer token and check all rate limits.
 *
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse}  response
 * @param {{ isAiCall?: boolean }} options
 * @returns {object|null} Token record on success, null if response already sent.
 */
export function checkAuth(request, response, { isAiCall = false } = {}) {
  if (!requiresApiToken()) {
    return {
      token: "local_no_auth",
      label: "Local no-auth mode",
      active: true,
      usage: {}
    };
  }

  // 1. Extract token from Authorization header
  const auth = request.headers["authorization"] || "";
  if (!auth.startsWith("Bearer ")) {
    sendError(response, 401, "missing_token",
      "Authorization header required. Format: Bearer fck_....");
    return null;
  }
  const rawToken = auth.slice(7).trim();

  // 2. Validate token exists and is active
  const record = validateToken(rawToken);
  if (!record) {
    sendError(response, 401, "invalid_token",
      "Invalid or revoked API token. Check your token in the Fitcheck options page.");
    return null;
  }

  // 3. Per-minute sliding window (in-memory — resets if server restarts, which is fine)
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (minuteWindows.get(rawToken) || []).filter((t) => t > windowStart);
  if (timestamps.length >= RPM_LIMIT) {
    sendError(response, 429, "rate_limit",
      `Too many requests — limit is ${RPM_LIMIT} per minute. Slow down and try again shortly.`);
    return null;
  }
  timestamps.push(now);
  minuteWindows.set(rawToken, timestamps);

  // 4. Daily request limit (persisted in tokens.json)
  const d = today();
  const usage = record.usage || {};
  const todayCount = usage.todayDate === d ? (usage.today || 0) : 0;
  if (todayCount >= DAILY_LIMIT) {
    sendError(response, 429, "daily_limit",
      `Daily request limit (${DAILY_LIMIT}) reached. Your allowance resets at midnight UTC.`);
    return null;
  }

  // 5. Daily AI call limit
  if (isAiCall) {
    const aiToday = usage.aiCallsDate === d ? (usage.aiCallsToday || 0) : 0;
    if (aiToday >= DAILY_AI_LIMIT) {
      sendError(response, 429, "daily_ai_limit",
        `Daily AI call limit (${DAILY_AI_LIMIT}) reached. Switch to Rules only mode or wait until midnight UTC.`);
      return null;
    }
  }

  return record;
}

function requiresApiToken() {
  return /^(1|true|yes|on)$/i.test(String(process.env.FITCHECK_REQUIRE_API_TOKEN || ""));
}
