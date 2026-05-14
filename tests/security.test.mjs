import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAllowedRequestOrigin,
  isLocalHostname,
  isLocalRequestAddress,
  MAX_ANALYZE_REQUEST_BYTES,
  normalizeApiUrl
} from "../src/shared/security.js";

test("normalizeApiUrl allows localhost http URLs", () => {
  assert.equal(normalizeApiUrl("http://127.0.0.1:8787/"), "http://127.0.0.1:8787");
  assert.equal(normalizeApiUrl("http://localhost:8787/api"), "http://localhost:8787/api");
});

test("normalizeApiUrl requires https for remote hosts", () => {
  assert.throws(() => normalizeApiUrl("http://api.example.com"), /must use https/i);
  assert.equal(normalizeApiUrl("https://api.example.com/analyze"), "https://api.example.com/analyze");
});

test("normalizeApiUrl rejects credentials and query strings", () => {
  assert.throws(() => normalizeApiUrl("https://user:pass@example.com"), /embedded credentials/i);
  assert.throws(() => normalizeApiUrl("https://api.example.com?token=1"), /query parameters or fragments/i);
});

test("origin policy allows extension and localhost origins by default", () => {
  assert.equal(isAllowedRequestOrigin("chrome-extension://abcdefghijklmnop"), true);
  assert.equal(isAllowedRequestOrigin("http://localhost:3000"), true);
  assert.equal(isAllowedRequestOrigin("https://127.0.0.1:4000"), true);
  assert.equal(isAllowedRequestOrigin("https://evil.example"), false);
});

test("origin policy respects explicit allowlist", () => {
  const allowlist = ["chrome-extension://fitcheck-prod-id"];
  assert.equal(isAllowedRequestOrigin("chrome-extension://fitcheck-prod-id", allowlist), true);
  assert.equal(isAllowedRequestOrigin("chrome-extension://other-id", allowlist), false);
});

test("local helpers identify loopback hosts and addresses", () => {
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("127.0.0.1"), true);
  assert.equal(isLocalRequestAddress("::1"), true);
  assert.equal(isLocalRequestAddress("192.168.1.12"), false);
  assert.ok(MAX_ANALYZE_REQUEST_BYTES >= 256 * 1024);
});
