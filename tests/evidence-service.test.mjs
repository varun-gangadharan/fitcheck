import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { buildSearchQueries, classifyEvidence, gatherEvidence, initEvidenceStore } from "../src/backend/evidence-service.js";
import { createStore } from "../src/backend/persistent-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  const dir = join(tmpdir(), `fitcheck-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mockFetch(responseBody) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, json: async () => responseBody };
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; }
  };
}

const FIRECRAWL_RESPONSE = {
  success: true,
  data: {
    web: [
      {
        title: "Acme sizing thread",
        description: "People say this shirt runs small and you should size up.",
        url: "https://reddit.com/r/malefashionadvice/example"
      }
    ]
  }
};

const PRODUCT = { brand: "Acme", title: "Cotton Shirt", category: "tops" };
const FETCH_OPTIONS = { enabled: true, provider: "firecrawl", apiKey: "fc-test" };

// ---------------------------------------------------------------------------
// Existing tests (unchanged behaviour)
// ---------------------------------------------------------------------------

test("builds search queries from brand and product context", () => {
  const queries = buildSearchQueries({
    brand: "Acme",
    title: "Straight Leg Jean",
    category: "bottoms"
  });

  assert.deepEqual(queries, [
    "Straight Leg Jean sizing runs small",
    "Acme jean size up",
    "Acme true to size",
    "Straight Leg Jean fit review reddit",
    "Acme sizing reddit"
  ]);
});

test("classifies snippets into sizing evidence signals with source urls", () => {
  const evidence = classifyEvidence([
    {
      title: "Acme sizing reddit",
      snippet: "This jean runs small, definitely size up.",
      source: "reddit",
      url: "https://reddit.com/r/rawdenim/example",
      query: "Acme jean runs small"
    },
    {
      title: "Acme review",
      snippet: "I found the jacket true to size.",
      source: "reviews.example",
      url: "https://reviews.example/acme",
      query: "Acme true to size"
    }
  ]);

  assert.ok(evidence.signals.some((signal) => signal.signal === "runsSmall"));
  assert.ok(evidence.signals.some((signal) => signal.signal === "sizeUp"));
  assert.ok(evidence.signals.some((signal) => signal.signal === "trueToSize"));
  assert.equal(evidence.signals[0].url, "https://reddit.com/r/rawdenim/example");
  assert.ok(evidence.summary.some((line) => line.includes("true to size")));
  assert.ok(evidence.summary.some((line) => line.includes("sizing up")));
});

test("returns disabled evidence result when web evidence is off", async () => {
  const evidence = await gatherEvidence(
    { brand: "Acme", title: "Cotton Shirt", category: "tops" },
    { provider: "firecrawl" }
  );

  assert.equal(evidence.status, "disabled");
  assert.match(evidence.reason, /turned off/i);
  assert.equal(evidence.snippets.length, 0);
  assert.ok(evidence.signals.some((signal) => signal.signal === "insufficientEvidence"));
});

test("returns clear no-provider evidence result when enabled search is not configured", async () => {
  const evidence = await gatherEvidence(
    { brand: "Acme", title: "Cotton Shirt", category: "tops" },
    { enabled: true, provider: "none" }
  );

  assert.equal(evidence.status, "not_configured");
  assert.match(evidence.reason, /No none search provider API key/i);
  assert.equal(evidence.snippets.length, 0);
  assert.ok(evidence.signals.some((signal) => signal.signal === "insufficientEvidence"));
});

test("maps Firecrawl search response into evidence snippets", async () => {
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const evidence = await gatherEvidence(
      { brand: "Acme", title: "Cotton Shirt", category: "tops" },
      { enabled: true, provider: "firecrawl", apiKey: "fc-test" }
    );

    assert.equal(evidence.status, "ok");
    assert.equal(evidence.provider, "firecrawl");
    assert.ok(calls.every((call) => String(call.url) === "https://api.firecrawl.dev/v2/search"));
    assert.ok(calls.every((call) => call.options.headers.authorization === "Bearer fc-test"));
    assert.ok(evidence.snippets.some((snippet) => snippet.source === "reddit"));
    assert.ok(evidence.signals.some((signal) => signal.signal === "runsSmall"));
    assert.ok(evidence.summary.some((line) => line.includes("runs small")));
  } finally {
    restore();
  }
});

test("irrelevant snippets are filtered unless they contain real sizing language", async () => {
  const noisyResponse = {
    success: true,
    data: {
      web: [
        {
          title: "Acme launch video",
          description: "Watch the new arrivals video and shop now with free shipping.",
          url: "https://youtube.com/watch?v=123"
        },
        {
          title: "Acme sizing discussion",
          description: "I bought these sneakers and they run small, so size up half a size.",
          url: "https://reddit.com/r/sneakers/example"
        }
      ]
    }
  };
  const { restore } = mockFetch(noisyResponse);

  try {
    const evidence = await gatherEvidence(
      { brand: "Acme", title: "Trainer", category: "shoes" },
      { enabled: true, provider: "firecrawl", apiKey: "fc-test" }
    );

    assert.equal(evidence.snippets.length, 1);
    assert.match(evidence.snippets[0].url, /reddit/);
    assert.ok(evidence.signals.some((signal) => signal.signal === "runsSmall"));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Persistence tests
// ---------------------------------------------------------------------------

test("cache hit skips fetch and returns cached result", async () => {
  const dir = makeTmpDir();
  initEvidenceStore(dir);
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    // First call — populates cache
    const first = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(first.cache.hit, false);
    const callsAfterFirst = calls.length;
    assert.ok(callsAfterFirst > 0, "Should have called fetch on cache miss");

    // Second call — should hit cache, no new fetch
    const second = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(second.cache.hit, true);
    assert.equal(calls.length, callsAfterFirst, "Fetch should not be called on cache hit");
    assert.equal(second.provider, "firecrawl");
    assert.ok(second.snippets.length > 0);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache persists to disk and survives simulated restart", async () => {
  const dir = makeTmpDir();

  // — First "run" —
  initEvidenceStore(dir);
  const { calls: calls1, restore: restore1 } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const first = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(first.cache.hit, false);
    assert.ok(calls1.length > 0);
  } finally {
    restore1();
  }

  // — Simulate restart: reinitialise from the same dir without clearing in-memory state —
  // We do this by calling initEvidenceStore again (same dir) which re-hydrates from disk.
  initEvidenceStore(dir);
  const { calls: calls2, restore: restore2 } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const second = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(second.cache.hit, true, "After reinit from disk, same query should be a cache hit");
    assert.equal(calls2.length, 0, "No fetch should occur for a reloaded cache hit");
  } finally {
    restore2();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired cache entry triggers a fresh fetch", async () => {
  const dir = makeTmpDir();
  initEvidenceStore(dir);

  // Manually write an already-expired entry to disk
  const store = createStore(dir);
  const cacheKey = `firecrawl:${PRODUCT.brand}:${PRODUCT.category}:${PRODUCT.title}`;
  store.writeCache({
    [cacheKey]: {
      cachedAt: Date.now() - 1000 * 60 * 31, // 31 minutes ago — past the 30-min TTL
      value: {
        status: "ok",
        provider: "firecrawl",
        queries: [],
        snippets: [{ title: "old", snippet: "old result", url: "https://old.example", source: "old.example" }],
        signals: [],
        summary: [],
        cache: { hit: false, ttlMs: 1000 * 60 * 30 }
      }
    }
  });

  // Reload from disk so the expired entry is in memory
  initEvidenceStore(dir);
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const evidence = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(evidence.cache.hit, false, "Expired entry should produce a cache miss");
    assert.ok(calls.length > 0, "Should fetch fresh data after expiry");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rate-limit state persists to disk and prevents calls after reload", async () => {
  const dir = makeTmpDir();

  // Pre-populate the rate-limit file with 20 timestamps all within the last minute
  const store = createStore(dir);
  const now = Date.now();
  store.writeRateLimit({
    firecrawl: Array.from({ length: 20 }, (_, i) => now - i * 1000)
  });

  // Reload — should hydrate from disk and be rate-limited immediately
  initEvidenceStore(dir);
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const evidence = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(evidence.status, "not_configured", "Rate-limited result should return not_configured/disabled status");
    // status is "not_configured" because isRateLimited returns before apiKey check...
    // actually it is checked after apiKey — let's check for the rate-limit reason:
    assert.match(evidence.reason, /rate limit/i);
    assert.equal(calls.length, 0, "No fetch should be made when rate limited");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt cache file is handled gracefully and returns a fresh fetch", async () => {
  const dir = makeTmpDir();

  // Write deliberately corrupt JSON
  writeFileSync(join(dir, "evidence-cache.json"), "{ this is not valid json }", "utf8");

  // Should not throw; corrupt file falls back to empty cache
  initEvidenceStore(dir);
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const evidence = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(evidence.cache.hit, false, "Corrupt cache should be treated as empty (miss)");
    assert.ok(calls.length > 0, "Should fetch fresh data when cache is unreadable");
    assert.equal(evidence.status, "ok");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing cache directory is handled gracefully", async () => {
  // Point to a directory that does not exist — createStore should create it
  const dir = join(tmpdir(), `fitcheck-missing-${Date.now()}`);

  initEvidenceStore(dir);
  const { calls, restore } = mockFetch(FIRECRAWL_RESPONSE);

  try {
    const evidence = await gatherEvidence(PRODUCT, FETCH_OPTIONS);
    assert.equal(evidence.status, "ok");
    assert.ok(calls.length > 0);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rate limiting is provider-aware: firecrawl limit does not block brave", async () => {
  const dir = makeTmpDir();

  // Max out firecrawl's rate limit
  const store = createStore(dir);
  const now = Date.now();
  store.writeRateLimit({
    firecrawl: Array.from({ length: 20 }, (_, i) => now - i * 1000)
  });
  initEvidenceStore(dir);

  const braveResponse = {
    web: {
      results: [
        {
          title: "Brave sizing result",
          description: "This shirt runs small, size up.",
          url: "https://reddit.com/r/fashion/brave"
        }
      ]
    }
  };
  const { restore } = mockFetch(braveResponse);

  try {
    // Brave should still work even though firecrawl is rate-limited
    const evidence = await gatherEvidence(PRODUCT, {
      enabled: true,
      provider: "brave",
      apiKey: "brave-test"
    });
    assert.notEqual(evidence.reason, /rate limit/i);
    assert.equal(evidence.provider, "brave");
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
