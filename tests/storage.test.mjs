import assert from "node:assert/strict";
import { test } from "node:test";
import { getBrandNotes, updateBrandMemoryFromOutcome } from "../src/shared/storage.js";

function createChromeStorageMock(initial = {}) {
  const state = { ...initial };
  return {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") return { [keys]: state[keys] };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, state[key]]));
          }
          return { ...state };
        },
        async set(values) {
          Object.assign(state, values);
        }
      }
    }
  };
}

test("outcomes update brand memory bias directly for future analyses", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createChromeStorageMock();

  try {
    const first = await updateBrandMemoryFromOutcome({
      id: "record-1",
      product: { brand: "Acme", category: "tops" },
      outcome: "too_small",
      note: "Needed to size up."
    });
    const second = await updateBrandMemoryFromOutcome({
      id: "record-2",
      product: { brand: "Acme", category: "tops" },
      outcome: "too_small",
      note: ""
    });
    const notes = await getBrandNotes();

    assert.equal(first.bias, 0.5);
    assert.equal(second.bias, 1);
    assert.equal(notes[0].outcomeCounts.too_small, 2);
    assert.equal(notes[0].typicalRecommendation, "size up");
  } finally {
    globalThis.chrome = originalChrome;
  }
});
