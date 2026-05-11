import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { extractProductFromHtml, looksLikeProductPage } from "../src/shared/extract-product.js";

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
  assert.equal(product.price, "");
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

test("extracts sizes and div-based size chart from Hydrogen/React storefront", async () => {
  const html = await fixture("hydrogen-product.html");
  const product = extractProductFromHtml(html, {
    url: "https://www.iongaf.xyz/products/red-sluttier-basic"
  });

  // Title and brand
  assert.ok(product.title, "Should detect title");
  assert.match(product.brand, /iongaf/i, "Should detect brand from site name or vendor");

  // Size options — from div buttons or script JSON
  assert.ok(product.sizeOptions.length >= 4, `Should detect S/M/L/XL, got: ${product.sizeOptions.join(", ")}`);
  assert.ok(product.sizeOptions.includes("S") && product.sizeOptions.includes("XL"), "Should include S and XL");

  // Div-based size chart (no <table> on page)
  assert.ok(product.sizeChart.tables.length >= 1, "Should extract div-based size chart");
  const table = product.sizeChart.tables[0];
  assert.ok(table.columns.length >= 2, "Size chart should have columns");
  assert.ok(table.rows.length >= 2, "Size chart should have data rows");
  const measurementLabels = table.rows.map((r) => Object.values(r)[0]).join(" ");
  assert.match(measurementLabels, /length|pit2pit|sleeve|hem/i, "Should include garment measurement labels");
});

test("looksLikeProductPage detects Shopify URL pattern", () => {
  // Should detect product page from /products/ URL alone (Shopify Hydrogen)
  assert.ok(looksLikeProductPage(null, "https://www.iongaf.xyz/products/red-sluttier-basic"));
  assert.ok(looksLikeProductPage(null, "https://store.example.com/products/blue-hoodie"));
  assert.ok(!looksLikeProductPage(null, "https://www.example.com/about"));
  assert.ok(!looksLikeProductPage(null, "https://www.example.com/collections/tees"));
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

// ---------------------------------------------------------------------------
// WooCommerce product page
// ---------------------------------------------------------------------------
test("extracts WooCommerce product: sizes from select, table chart, fit signals", async () => {
  const product = extractProductFromHtml(await fixture("woocommerce-product.html"), {
    url: "https://streetwearco.example/product/classic-slim-hoodie"
  });

  assert.equal(product.brand, "Streetwear Co");
  assert.ok(/hoodie/i.test(product.title));
  assert.equal(product.category, "tops");
  assert.ok(product.sizeOptions.includes("XS") && product.sizeOptions.includes("XL"),
    `sizeOptions: ${product.sizeOptions.join(", ")}`);
  assert.ok(product.sizeChart.tables.length >= 1, "Should find at least one HTML table");
  assert.ok(product.sizeChart.tables.some((t) => t.columns.some((c) => /chest/i.test(c))),
    "At least one table should have a Chest column");
  assert.ok(product.fitSignals.some((s) => s.type === "runs_small"), "Should detect 'runs small'");
  assert.match(product.returnPolicy, /30 days/i);
});

// ---------------------------------------------------------------------------
// Shopify classic theme (radio inputs + JSON script tag)
// ---------------------------------------------------------------------------
test("extracts Shopify classic product: radio inputs, JSON variants, HTML table", async () => {
  const product = extractProductFromHtml(await fixture("shopify-classic-product.html"), {
    url: "https://representclo.com/products/essential-crew-tee-white"
  });

  assert.ok(/represent/i.test(product.brand), `brand: ${product.brand}`);
  assert.equal(product.category, "tops");
  // Sizes from radio inputs or JSON variants
  assert.ok(product.sizeOptions.length >= 4, `sizeOptions: ${product.sizeOptions.join(", ")}`);
  assert.ok(product.sizeOptions.includes("M") && product.sizeOptions.includes("XL"));
  // HTML size chart table
  assert.ok(product.sizeChart.tables.length >= 1, "Should detect size chart table");
  // Fit signals from description
  assert.ok(product.fitSignals.some((s) => s.type === "true_to_size"), "Should detect 'true to size'");
  assert.ok(product.fitSignals.some((s) => s.type === "oversized"), "Should detect 'oversized'");
});

// ---------------------------------------------------------------------------
// Bottoms with numeric W×L sizes
// ---------------------------------------------------------------------------
test("extracts bottoms with numeric waist×length size options", async () => {
  const product = extractProductFromHtml(await fixture("bottoms-numeric-product.html"), {
    url: "https://levis.example/products/501-original-fit-jeans"
  });

  assert.ok(/levi/i.test(product.brand), `brand: ${product.brand}`);
  assert.equal(product.category, "bottoms");
  // Numeric sizes like 28x30, 30x32 — extracted from aria-label buttons
  assert.ok(product.sizeOptions.length >= 4, `sizeOptions: ${product.sizeOptions.join(", ")}`);
  // Size chart with waist/inseam columns
  assert.ok(product.sizeChart.tables.length >= 1, "Should detect size chart");
  assert.ok(
    product.sizeChart.tables[0].columns.some((c) => /waist/i.test(c)),
    `columns: ${product.sizeChart.tables[0].columns.join(", ")}`
  );
  assert.ok(product.fitSignals.some((s) => s.type === "true_to_size"), "Should detect 'true to size'");
  assert.ok(product.fitSignals.some((s) => s.type === "non_stretch"), "Should detect 'non-stretch'");
});

// ---------------------------------------------------------------------------
// Product with sizes but no size chart — should flag missing chart
// ---------------------------------------------------------------------------
test("extracts product without size chart and flags it as missing", async () => {
  const product = extractProductFromHtml(await fixture("no-size-chart-product.html"), {
    url: "https://localbrand.example/products/vintage-wash-tee"
  });

  assert.equal(product.category, "tops");
  assert.ok(product.sizeOptions.length >= 3, `sizeOptions: ${product.sizeOptions.join(", ")}`);
  assert.equal(product.sizeChart.tables.length, 0, "Should have no chart tables");
  assert.ok(product.extractedSignals.missingFields.includes("sizeChart"), "Should flag missing chart");
  assert.ok(product.fitSignals.some((s) => s.type === "runs_large"), "Should detect 'runs large'");
  assert.ok(product.fitSignals.some((s) => s.type === "oversized"), "Should detect 'oversized'");
});

test("extracts shoes with sold-out variants cleaned and price preserved", async () => {
  const product = extractProductFromHtml(await fixture("shoes-product.html"), {
    url: "https://stride.example/products/air-trainer-pro"
  });

  assert.equal(product.category, "shoes");
  assert.equal(product.brand, "Stride Collective");
  assert.equal(product.price, "$130");
  assert.ok(product.sizeOptions.includes("10.5"), `sizeOptions: ${product.sizeOptions.join(", ")}`);
  assert.ok(product.sizeOptions.includes("11.5"), `sizeOptions: ${product.sizeOptions.join(", ")}`);
  assert.ok(!product.sizeOptions.some((size) => /sold out|stock/i.test(size)));
  assert.ok(product.fitSignals.some((signal) => signal.type === "runs_narrow"));
  assert.ok(product.fitSignals.some((signal) => signal.type === "half_size_up"));
  assert.ok(product.sizeChart.tables[0].columns.some((column) => /foot length/i.test(column)));
});

test("extracts accessories with one-size options", async () => {
  const product = extractProductFromHtml(await fixture("accessory-product.html"), {
    url: "https://orbit.example/products/canvas-belt-bag"
  });

  assert.equal(product.category, "accessories");
  assert.equal(product.price, "48.00");
  assert.deepEqual(product.sizeOptions, ["ONE SIZE"]);
  assert.match(product.fabricComposition, /recycled nylon/i);
  assert.match(product.returnPolicy, /14 days/i);
});
