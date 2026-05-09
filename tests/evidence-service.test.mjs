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
});

test("returns clear no-provider evidence result when search is not configured", async () => {
  const evidence = await gatherEvidence(
    { brand: "Acme", title: "Cotton Shirt", category: "tops" },
    { provider: "none" }
  );

  assert.equal(evidence.status, "not_configured");
  assert.match(evidence.reason, /No search provider/i);
  assert.equal(evidence.snippets.length, 0);
  assert.ok(evidence.signals.some((signal) => signal.signal === "insufficientEvidence"));
});
