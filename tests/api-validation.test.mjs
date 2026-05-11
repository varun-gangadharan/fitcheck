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
      category: "outerwear",
      sizeOptions: "M"
    },
    profile: {
      mode: "lightweight",
      usualSizes: { tops: "M" }
    }
  });

  assert.ok(errors.includes("product.title is required."));
  assert.ok(errors.includes("product.url is required."));
  assert.ok(errors.includes("product.category must be tops, bottoms, shoes, accessories, or unknown."));
  assert.ok(errors.includes("product.sizeOptions must be an array."));
});

test("validation accepts shoes and accessories categories", () => {
  const shoeErrors = validateAnalyzeRequest({
    product: {
      title: "Air Trainer Pro",
      url: "https://shop.example/shoe",
      category: "shoes",
      sizeOptions: ["9", "9.5", "10"]
    },
    profile: {
      mode: "lightweight",
      usualSizes: { shoes: "10" }
    }
  });
  const accessoryErrors = validateAnalyzeRequest({
    product: {
      title: "Canvas Belt Bag",
      url: "https://shop.example/bag",
      category: "accessories",
      sizeOptions: ["ONE SIZE"]
    },
    profile: {
      mode: "lightweight",
      usualSizes: { tops: "M" }
    }
  });

  assert.deepEqual(shoeErrors, []);
  assert.deepEqual(accessoryErrors, []);
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
