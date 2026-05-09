import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAnalyzeRequest } from "../src/backend/validation.js";

test("validation rejects empty payloads", () => {
  const errors = validateAnalyzeRequest({});

  assert.ok(errors.includes("product is required."));
  assert.ok(errors.includes("profile is required."));
});

test("validation rejects incomplete product payloads", () => {
  const errors = validateAnalyzeRequest({
    product: {
      title: "",
      url: "",
      category: "shoes",
      sizeOptions: "M"
    },
    profile: {
      mode: "lightweight",
      usualSizes: { tops: "M" }
    }
  });

  assert.ok(errors.includes("product.title is required."));
  assert.ok(errors.includes("product.url is required."));
  assert.ok(errors.includes("product.category must be tops, bottoms, or unknown."));
  assert.ok(errors.includes("product.sizeOptions must be an array."));
});

test("validation accepts minimal valid analyze payload", () => {
  const errors = validateAnalyzeRequest({
    product: {
      title: "Oxford Shirt",
      url: "https://shop.example/item",
      category: "tops",
      sizeOptions: ["S", "M", "L"]
    },
    profile: {
      mode: "lightweight",
      usualSizes: { tops: "M", bottoms: "30" }
    },
    brandMemory: [],
    history: []
  });

  assert.deepEqual(errors, []);
});
