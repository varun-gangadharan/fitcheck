import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchQueries, classifyEvidence, gatherEvidence } from "../src/backend/evidence-service.js";

test("builds search queries from brand and product context", () => {
  const queries = buildSearchQueries({
    brand: "Acme",
    title: "Straight Leg Jean",
    category: "bottoms"
  });

  assert.deepEqual(queries, [
    "Acme jean runs small",
    "Acme bottoms size up",
    "Acme true to size",
    "Acme fit thread",
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
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
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
      })
    };
  };

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
    globalThis.fetch = originalFetch;
  }
});
