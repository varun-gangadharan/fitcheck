import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractProductFromHtml } from "../src/shared/extract-product.js";

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

test("extracts normalized top product details", async () => {
  const product = extractProductFromHtml(await fixture("top-product.html"), {
    url: "https://shop.example/top"
  });

  assert.equal(product.title, "Boxy Oxford Shirt");
  assert.equal(product.brand, "Everlane");
  assert.equal(product.category, "tops");
  assert.deepEqual(product.sizeOptions, ["XS", "S", "M", "L", "XL"]);
  assert.equal(product.sizeChart.tables.length, 1);
  assert.deepEqual(product.sizeChart.tables[0].columns, ["Size", "Chest", "Length"]);
  assert.equal(product.sizeChart.tables[0].rows[1].Chest, "40 in");
  assert.match(product.fabricComposition, /organic cotton/i);
  assert.match(product.returnPolicy, /30 days/i);
  assert.ok(product.fitSignals.some((signal) => signal.type === "oversized"));
  assert.ok(product.fitSignals.some((signal) => signal.type === "relaxed_fit"));
});

test("extracts normalized bottom product details", async () => {
  const product = extractProductFromHtml(await fixture("bottom-product.html"), {
    url: "https://shop.example/bottom"
  });

  assert.equal(product.title, "Straight Leg Jean");
  assert.equal(product.brand, "Denim Co");
  assert.equal(product.category, "bottoms");
  assert.deepEqual(product.sizeOptions, ["26", "27", "28", "29", "30", "31"]);
  assert.equal(product.sizeChart.tables[0].rows[0].Inseam, "30 in");
  assert.ok(product.fitSignals.some((signal) => signal.type === "runs_small"));
  assert.ok(product.fitSignals.some((signal) => signal.type === "non_stretch"));
});

test("represents missing data without crashing", async () => {
  const product = extractProductFromHtml(await fixture("minimal-product.html"), {
    url: "https://shop.example/minimal"
  });

  assert.equal(product.title, "Gift Card");
  assert.equal(product.category, "unknown");
  assert.deepEqual(product.sizeOptions, []);
  assert.deepEqual(product.sizeChart.tables, []);
  assert.ok(product.extractedSignals.missingFields.includes("brand"));
  assert.ok(product.extractedSignals.missingFields.includes("sizeOptions"));
  assert.ok(product.extractedSignals.missingFields.includes("sizeChart"));
});
