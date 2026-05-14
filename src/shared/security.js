const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export const MAX_ANALYZE_REQUEST_BYTES = 256 * 1024;

export function isLocalHostname(hostname = "") {
  return LOCAL_HOSTS.has(String(hostname || "").trim().toLowerCase());
}

export function isLocalRequestAddress(remoteAddress = "") {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

export function normalizeApiUrl(value, fallback = "http://localhost:8787") {
  const raw = String(value || fallback).trim();
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    throw new Error("API URL must be a valid http:// or https:// URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("API URL must use http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("API URL cannot include embedded credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("API URL cannot include query parameters or fragments.");
  }
  if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
    throw new Error("Remote API URLs must use https://. Plain http:// is allowed only for localhost.");
  }

  const normalized = url.toString().replace(/\/+$/, "");
  return normalized || url.origin;
}

export function isAllowedRequestOrigin(origin, explicitAllowedOrigins = []) {
  const trimmed = String(origin || "").trim();
  if (!trimmed) return true;

  if (explicitAllowedOrigins.length) {
    return explicitAllowedOrigins.includes(trimmed);
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "chrome-extension:") return true;
    if (["http:", "https:"].includes(url.protocol) && isLocalHostname(url.hostname)) return true;
    return false;
  } catch (_error) {
    return false;
  }
}
