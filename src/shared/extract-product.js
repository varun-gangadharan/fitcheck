import { EMPTY_PRODUCT_RECORD } from "./models.js";

const DEBUG_STORAGE_KEY = "fitcheck:debug";

// Clothing sizes
const SIZE_TOKENS = new Set([
  "ONE SIZE", "OS", "O/S",
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL",
  // Women's numeric dress/pants
  "0", "2", "4", "6", "8", "10", "12", "14", "16", "18",
  // Jeans waist
  "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "36", "38", "40",
  // EU shoe sizes
  "35", "36", "37", "38", "39", "41", "42", "43", "44", "45", "46", "47", "48",
  // US shoe half-sizes (stored as strings with decimal)
  "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14", "15"
]);

const FIT_SIGNAL_PATTERNS = [
  { type: "runs_small",   label: "Runs small",    pattern: /\bruns?\s+small\b|\bsize\s+up\b/i },
  { type: "runs_large",   label: "Runs large",    pattern: /\bruns?\s+large\b|\bsize\s+down\b/i },
  { type: "true_to_size", label: "True to size",  pattern: /\btrue\s+to\s+size\b|\btts\b/i },
  { type: "oversized",    label: "Oversized",     pattern: /\boversi[sz]ed\b/i },
  { type: "slim_fit",     label: "Slim fit",      pattern: /\bslim\s+fit\b|\btailored\s+fit\b/i },
  { type: "relaxed_fit",  label: "Relaxed fit",   pattern: /\brelaxed\s+fit\b|\bloose\s+fit\b/i },
  { type: "stretch",      label: "Stretch",       pattern: /\bstretch\b|\belastane\b|\bspandex\b/i },
  { type: "non_stretch",  label: "Non-stretch",   pattern: /\bnon[-\s]?stretch\b|\bno\s+stretch\b/i },
  // Shoe-specific
  { type: "runs_narrow",  label: "Runs narrow",   pattern: /\bruns?\s+narrow\b|\bfits?\s+narrow\b|\bnarrow\s+(?:fit|width)\b/i },
  { type: "runs_wide",    label: "Runs wide",     pattern: /\bruns?\s+wide\b|\bfits?\s+wide\b|\bwide\s+(?:fit|width)\b/i },
  { type: "half_size_up", label: "Half size up",  pattern: /\bhalf(?:\s+a)?\s+size\s+up\b|\bgo\s+half\s+(?:a\s+)?size\b/i }
];

export function extractProductFromDocument(documentRef = globalThis.document, options = {}) {
  const debug = getDebugFlag(options);
  const url = options.url || globalThis.location?.href || "";
  const locationLike = safeUrl(url);
  const title = firstNonEmpty([
    getMeta(documentRef, "property", "og:title"),
    getMeta(documentRef, "name", "twitter:title"),
    getJsonLdValue(documentRef, ["name"]),
    getText(documentRef, [
      "[data-testid*='product-title' i]",
      "[class*='product'][class*='title' i]",
      "[class*='product-title' i]",
      "[itemprop='name']",
      "h1"
    ]),
    documentRef?.title
  ]);
  const brand = firstNonEmpty([
    getMeta(documentRef, "property", "product:brand"),
    getJsonLdBrand(documentRef),
    getText(documentRef, [
      "[itemprop='brand']",
      "[data-brand]",
      "[data-testid*='brand' i]",
      "[class*='brand' i]",
      "meta[property='og:site_name']"
    ]),
    getMeta(documentRef, "property", "og:site_name"),
    guessBrandFromTitle(title)
  ]);
  const pageText = getVisibleText(documentRef);
  const sizeOptions = extractSizeOptionsFromDocument(documentRef);
  const sizeChart = extractSizeChartFromDocument(documentRef, pageText);
  const fabricComposition = findNearbyText(pageText, FABRIC_KEYWORDS);
  const returnPolicy = findNearbyText(pageText, RETURN_KEYWORDS);
  const fitSignals = extractFitSignals(pageText);
  const price = extractPrice(documentRef);
  const category = inferCategory({
    title,
    description: getMeta(documentRef, "name", "description"),
    url,
    pageText: pageText.slice(0, 1200)
  });
  const hasAddToCart = Boolean(
    documentRef?.querySelector?.(
      "button[name*='add' i], button[id*='add' i], " +
      "[aria-label*='add to cart' i], [aria-label*='add to bag' i], " +
      "[data-add-to-cart], [data-testid*='add-to-cart' i], " +
      "button[type='submit'][class*='cart' i], button[type='submit'][class*='AddToCart' i], " +
      "form[action*='/cart'] button[type='submit'], form[action*='cart/add'] button"
    )
  );
  const product = normalizeProductRecord({
    url,
    brand,
    title,
    category,
    price,
    sizeOptions,
    sizeChart,
    fabricComposition,
    returnPolicy,
    fitSignals,
    extractedSignals: {
      hasSizeSelector: sizeOptions.length > 0,
      hasAddToCart,
      sourceHost: locationLike?.hostname || "",
      detectedAt: new Date().toISOString()
    }
  });

  debugLog(debug, "extractProductFromDocument", product);
  return product;
}

export function extractProductFromHtml(html, options = {}) {
  if (globalThis.DOMParser) {
    const documentRef = new DOMParser().parseFromString(html, "text/html");
    return extractProductFromDocument(documentRef, options);
  }

  const pageText = stripTags(html);
  const title = firstNonEmpty([
    getMetaFromHtml(html, "property", "og:title"),
    getMetaFromHtml(html, "name", "twitter:title"),
    getFirstTagText(html, "h1"),
    getTitleFromHtml(html)
  ]);
  const brand = firstNonEmpty([
    getMetaFromHtml(html, "property", "product:brand"),
    getTextByAttributeFromHtml(html, "itemprop", "brand"),
    getTextByAttributeFromHtml(html, "data-testid", "brand"),
    getTextByClassFromHtml(html, "brand"),
    getMetaFromHtml(html, "property", "og:site_name"),
    guessBrandFromTitle(title)
  ]);
  // Collect inline script contents for JSON-based extraction
  const scriptTexts = [];
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    scriptTexts.push(match[1]);
  }

  const sizeOptions = uniqueClean([
    ...extractSelectOptionsFromHtml(html),
    ...extractSizeButtonsFromHtml(html),
    ...extractSizeOptionsFromScriptTexts(scriptTexts)
  ]).filter(isLikelySize);

  const htmlTables = extractTablesFromHtml(html);
  const scriptTables = htmlTables.length ? [] : extractSizeChartFromScriptTexts(scriptTexts);
  const sizeChart = {
    sourceText: findNearbyText(pageText, SIZE_CHART_KEYWORDS),
    tables: [...htmlTables, ...scriptTables]
  };
  const product = normalizeProductRecord({
    url: options.url || "",
    brand,
    title,
    category: inferCategory({
      title,
      description: getMetaFromHtml(html, "name", "description"),
      url: options.url || "",
      pageText: pageText.slice(0, 1200)
    }),
    price: extractPriceFromHtml(html, pageText),
    sizeOptions,
    sizeChart,
    fabricComposition: findNearbyText(pageText, FABRIC_KEYWORDS),
    returnPolicy: findNearbyText(pageText, RETURN_KEYWORDS),
    fitSignals: extractFitSignals(pageText),
    extractedSignals: {
      hasSizeSelector: sizeOptions.length > 0,
      hasAddToCart: /add\s+to\s+(cart|bag)/i.test(pageText),
      sourceHost: safeUrl(options.url)?.hostname || "",
      detectedAt: new Date().toISOString()
    }
  });

  debugLog(getDebugFlag(options), "extractProductFromHtml", product);
  return product;
}

export function normalizeProductRecord(record) {
  const product = {
    ...EMPTY_PRODUCT_RECORD,
    ...record,
    sizeChart: {
      ...EMPTY_PRODUCT_RECORD.sizeChart,
      ...(record.sizeChart || {})
    },
    extractedSignals: {
      ...EMPTY_PRODUCT_RECORD.extractedSignals,
      ...(record.extractedSignals || {})
    }
  };
  const missingFields = [];

  if (!product.title) missingFields.push("title");
  if (!product.brand) missingFields.push("brand");
  if (!product.sizeOptions.length) missingFields.push("sizeOptions");
  if (!product.sizeChart.sourceText && !product.sizeChart.tables.length) missingFields.push("sizeChart");
  if (!product.fabricComposition) missingFields.push("fabricComposition");
  if (!product.returnPolicy) missingFields.push("returnPolicy");

  return {
    ...product,
    brand: clean(product.brand),
    title: clean(product.title),
    price: clean(product.price),
    category: PRODUCT_CATEGORIES.includes(product.category) ? product.category : "unknown",
    sizeOptions: uniqueClean(product.sizeOptions),
    fitSignals: dedupeSignals(product.fitSignals),
    extractedSignals: {
      ...product.extractedSignals,
      missingFields
    }
  };
}

const PRODUCT_CATEGORIES = ["tops", "bottoms", "shoes", "accessories", "unknown"];

export function looksLikeProductPage(documentRef = globalThis.document, url = "") {
  // URL pattern match — Shopify, WooCommerce, most e-commerce platforms
  if (/\/products?\/|\/shop\/[^/]+$|\/item\//i.test(url || globalThis.location?.href || "")) {
    return true;
  }
  // og:type = "product"
  const ogType = getMeta(documentRef, "property", "og:type");
  if (/product/i.test(ogType)) return true;
  // Page text signals
  const text = getVisibleText(documentRef).toLowerCase();
  if (/add to cart|add to bag|size chart|size guide|select size|choose a size/.test(text)) {
    return true;
  }
  // Price element present (strong signal of a product page)
  if (documentRef?.querySelector?.("[class*='price' i], [itemprop='price'], [data-price]")) {
    return true;
  }
  return false;
}

const SIZE_CHART_KEYWORDS = [
  "size chart", "size guide", "measurements", "waist", "inseam", "chest", "bust",
  "hips", "sleeve", "pit2pit", "hem", "length", "shoulder",
  // Shoe-specific
  "foot length", "eu size", "uk size", "us size", "insole"
];
const FABRIC_KEYWORDS = ["fabric", "composition", "materials", "cotton", "polyester", "wool", "linen", "elastane", "spandex", "viscose", "nylon"];
const RETURN_KEYWORDS = ["return", "returns", "exchange", "refund", "final sale"];

function extractSizeOptionsFromDocument(documentRef) {
  const selectors = [
    "select[name*='size' i] option",
    "select[id*='size' i] option",
    "[role='listbox'][aria-label*='size' i] [role='option']",
    "[aria-label*='size' i] button",
    "[data-testid*='size' i]",
    "[class*='size' i] button",
    "button[name*='size' i]",
    "input[name*='size' i]",
    // Shopify / Hydrogen patterns
    "input[type='radio'][name='Size']",
    "input[type='radio'][name='size']",
    "[data-option-name*='size' i] input",
    "[data-option*='size' i]",
    "[data-value][class*='swatch' i]",
    "[data-value][class*='size' i]"
  ];
  const values = [];

  for (const selector of selectors) {
    documentRef?.querySelectorAll?.(selector).forEach((element) => {
      const value = element.value || element.getAttribute("value") || element.getAttribute("data-value") || element.getAttribute("aria-label") || element.textContent;
      values.push(cleanSize(value));
    });
  }

  // Fallback: scan inline scripts for Shopify/Hydrogen JSON variant data
  if (!values.length) {
    values.push(...extractSizeOptionsFromScripts(documentRef));
  }

  return uniqueClean(values).filter(isLikelySize);
}

/**
 * Scans inline <script> tags for product variant/option data.
 * Handles Shopify Hydrogen (optionValues), classic Shopify (option1), and
 * any store that embeds variant JSON in the page.
 */
function extractSizeOptionsFromScripts(documentRef) {
  const scriptTexts = Array.from(documentRef?.querySelectorAll?.("script:not([src])") || [])
    .map((s) => s.textContent || "");
  return extractSizeOptionsFromScriptTexts(scriptTexts);
}

/** Core logic — operates on an array of script content strings (works in both DOM and HTML paths). */
function extractSizeOptionsFromScriptTexts(scriptTexts) {
  const values = [];

  for (const text of scriptTexts) {
    if (text.length > 300_000) continue; // skip enormous bundles

    // Hydrogen: "optionValues":[{"name":"S",...},{"name":"M",...}]
    for (const block of text.matchAll(/"optionValues"\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const nameMatch of block[1].matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
        values.push(nameMatch[1]);
      }
    }

    // Classic Shopify liquid: "option1":"S"
    for (const match of text.matchAll(/"option[123]"\s*:\s*"([^"]{1,20})"/g)) {
      values.push(match[1]);
    }

    // Generic: "variants":[{"title":"S",...}]  (only short title values)
    for (const block of text.matchAll(/"variants"\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const match of block[1].matchAll(/"title"\s*:\s*"([^"]{1,8})"/g)) {
        if (isLikelySize(match[1])) values.push(match[1]);
      }
    }
  }

  return values;
}

function extractSizeChartFromDocument(documentRef, pageText) {
  // 1. Standard HTML <table> elements
  const htmlTables = Array.from(documentRef?.querySelectorAll?.("table") || [])
    .map(tableToStructuredData)
    .filter((table) => table.columns.length || table.rows.length);

  // 2. Div/grid-based size charts (common in React/Hydrogen storefronts)
  const divTables = htmlTables.length ? [] : extractDivTablesFromDocument(documentRef);

  // 3. JSON size chart data embedded in inline scripts
  const scriptTables = (htmlTables.length || divTables.length) ? [] : extractSizeChartFromScripts(documentRef);

  const tables = [...htmlTables, ...divTables, ...scriptTables];
  const nearby = findNearbyText(pageText, SIZE_CHART_KEYWORDS);

  return { sourceText: nearby, tables };
}

/**
 * Extracts table-like data from div/grid structures — used when the size chart
 * is rendered by a JS framework rather than as an HTML <table>.
 */
function extractDivTablesFromDocument(documentRef) {
  const MEASUREMENT_RE = /\b(length|width|chest|bust|waist|hip|shoulder|sleeve|pit.?2.?pit|hem|inseam|rise|thigh|knee|foot|eu|uk)\b/i;
  const tables = [];

  // Try labeled containers first (most reliable)
  const containerSel = [
    "[class*='size-chart' i]", "[class*='sizechart' i]", "[class*='size_chart' i]",
    "[id*='size-chart' i]",   "[id*='sizechart' i]",
    "[class*='measurement' i]", "[class*='size-guide' i]", "[id*='size-guide' i]",
    "[class*='sizing' i]"
  ].join(", ");

  for (const container of (documentRef?.querySelectorAll?.(containerSel) || [])) {
    const table = parseGridContainer(container);
    if (table && table.rows.length >= 1) {
      tables.push(table);
    }
  }

  if (tables.length) return tables;

  // Fallback: find any div/section with consistent row structure + measurement keywords
  for (const el of (documentRef?.querySelectorAll?.("div, section, ul") || [])) {
    if (!MEASUREMENT_RE.test(el.textContent)) continue;
    const children = Array.from(el.children).filter(
      (c) => ["DIV", "LI", "P"].includes(c.tagName)
    );
    if (children.length < 2 || children.length > 30) continue;

    const table = parseGridContainer(el);
    if (table && table.rows.length >= 2 && MEASUREMENT_RE.test(table.columns.join(" "))) {
      tables.push(table);
      break;
    }
  }

  return tables;
}

/**
 * Attempts to read a container's children as rows of a table.
 * Returns null if the structure isn't table-like.
 */
function parseGridContainer(container) {
  const CELL_TAGS = new Set(["DIV", "SPAN", "LI", "TD", "TH", "P"]);
  const childRows = Array.from(container.children).filter(
    (c) => ["DIV", "LI", "TR", "P"].includes(c.tagName)
  );
  if (childRows.length < 2) return null;

  // Find the most common child-cell count across rows
  const cellCounts = childRows.map(
    (row) => Array.from(row.children).filter((c) => CELL_TAGS.has(c.tagName)).length
  );
  const freq = {};
  for (const n of cellCounts) freq[n] = (freq[n] || 0) + 1;
  const bestCount = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]);
  if (bestCount < 2) return null;

  const rows = childRows
    .filter((_, i) => cellCounts[i] === bestCount)
    .map((row) =>
      Array.from(row.children)
        .filter((c) => CELL_TAGS.has(c.tagName))
        .map((cell) => clean(cell.textContent))
    );

  if (rows.length < 2) return null;

  const columns = rows[0];
  const dataRows = rows.slice(1).map((row) => rowToObject(columns, row));
  const caption = clean(container.querySelector("h2, h3, h4, caption, legend")?.textContent || "");

  return { caption, columns, rows: dataRows };
}

/**
 * Extracts structured size chart data from inline <script> JSON blobs.
 * Handles Shopify Hydrogen's sizeGuideTable and similar patterns.
 */
function extractSizeChartFromScripts(documentRef) {
  const scriptTexts = Array.from(documentRef?.querySelectorAll?.("script:not([src])") || [])
    .map((s) => s.textContent || "");
  return extractSizeChartFromScriptTexts(scriptTexts);
}

/** Core logic — operates on an array of script content strings (works in both DOM and HTML paths). */
function extractSizeChartFromScriptTexts(scriptTexts) {
  for (const text of scriptTexts) {
    if (text.length > 300_000) continue;

    // Look for {columns:[...],"columns":[...], rows:[...]} shape (Hydrogen sizeGuideTable, etc.)
    // Handles both JSON (quoted keys) and JS object literals (unquoted keys).
    for (const match of text.matchAll(/(?:"columns"|columns)\s*:\s*(\[(?:"[^"]*"(?:,\s*)?)+\])\s*,\s*(?:"rows"|rows)\s*:\s*(\[[\s\S]*?\])\s*[,}]/g)) {
      try {
        const columns = JSON.parse(match[1]);
        const rows = JSON.parse(match[2]);
        if (Array.isArray(columns) && columns.length >= 2 && Array.isArray(rows) && rows.length >= 1) {
          const normRows = rows.map((row) => {
            const obj = {};
            for (const [k, v] of Object.entries(row)) obj[k] = String(v ?? "");
            return obj;
          });
          return [{ caption: "Size Guide", columns, rows: normRows }];
        }
      } catch (_) { /* keep scanning */ }
    }

    // Named keys: sizeGuideTable, sizeChart, measurementTable, etc. (quoted or unquoted)
    for (const key of ["sizeGuideTable", "sizeChart", "size_chart", "measurementTable", "sizingTable"]) {
      const re = new RegExp(`(?:"${key}"|${key})\\s*:\\s*(\\{[\\s\\S]{10,3000}?\\})`, "g");
      for (const match of text.matchAll(re)) {
        try {
          const data = JSON.parse(match[1]);
          if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
            const normRows = data.rows.map((row) => {
              const obj = {};
              for (const [k, v] of Object.entries(row)) obj[k] = String(v ?? "");
              return obj;
            });
            return [{ caption: "Size Guide", columns: data.columns, rows: normRows }];
          }
        } catch (_) { /* keep scanning */ }
      }
    }
  }

  return [];
}

// ── Price extraction ──────────────────────────────────────────────────────────

const PRICE_CURRENCY_SYMBOLS = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", CAD: "CA$", AUD: "A$" };

function formatPrice(amount, currency) {
  const sym = PRICE_CURRENCY_SYMBOLS[String(currency).toUpperCase()] || (currency ? `${currency} ` : "");
  return `${sym}${amount}`.trim();
}

/** Extract price from a live DOM document. */
function extractPrice(documentRef) {
  // 1. JSON-LD offers.price
  const scripts = Array.from(documentRef?.querySelectorAll?.("script[type='application/ld+json']") || []);
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent);
      const items = (Array.isArray(json) ? json : [json]).flatMap(flattenGraph);
      for (const item of items) {
        const offer = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
        if (offer?.price) return formatPrice(offer.price, offer.priceCurrency || "");
      }
    } catch (_) { /* ignore */ }
  }

  // 2. Meta tags
  const amount = getMeta(documentRef, "property", "product:price:amount") ||
                 getMeta(documentRef, "property", "og:price:amount");
  if (amount) {
    const currency = getMeta(documentRef, "property", "product:price:currency") ||
                     getMeta(documentRef, "property", "og:price:currency");
    return formatPrice(amount, currency);
  }

  // 3. DOM selectors (prefer content attribute, fall back to text)
  const priceSelectors = [
    "[itemprop='price']",
    "[data-product-price]",
    "[data-price]",
    ".price__regular",
    ".price-item--regular",
    "[class*='product-price' i]",
    "[class*='price' i][class*='current' i]",
    "#price"
  ];
  for (const sel of priceSelectors) {
    const el = documentRef?.querySelector?.(sel);
    if (!el) continue;
    const raw = el.getAttribute?.("content") || el.getAttribute?.("data-price") || el.textContent;
    const cleaned = clean(raw).replace(/\s+/g, "").slice(0, 40);
    if (/[\d]/.test(cleaned)) return cleaned;
  }

  return "";
}

/** Extract price from raw HTML (no DOMParser). */
function extractPriceFromHtml(html, pageText) {
  // 1. JSON-LD
  for (const scriptMatch of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const json = JSON.parse(scriptMatch[1]);
      const items = (Array.isArray(json) ? json : [json]);
      for (const item of items) {
        const offer = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
        if (offer?.price) return formatPrice(offer.price, offer.priceCurrency || "");
      }
    } catch (_) { /* ignore */ }
  }

  // 2. Meta tags
  const amount = getMetaFromHtml(html, "property", "product:price:amount") ||
                 getMetaFromHtml(html, "property", "og:price:amount");
  if (amount) {
    const currency = getMetaFromHtml(html, "property", "product:price:currency") || "";
    return formatPrice(amount, currency);
  }

  // 3. itemprop="price" with content attribute
  const ipMatch = html.match(/<[^>]+itemprop=["']price["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  if (ipMatch) return clean(ipMatch[1]).slice(0, 40);

  // 4. Look for a price-looking string near "price" keyword in page text
  const priceLineMatch = pageText.match(/(?:price|cost)[\s:]*([€$£¥]?\s*\d[\d,.']*)/i);
  if (priceLineMatch) return clean(priceLineMatch[1]).slice(0, 40);

  return "";
}

// ── Category inference ────────────────────────────────────────────────────────

const CATEGORY_PATTERNS = {
  shoes: /\b(shoes?|sneakers?|trainers?|boots?|heels?|loafers?|sandals?|stilettos?|pumps?|mules?|clogs?|espadrilles?|oxfords?|derbys?|slingbacks?|footwear|slippers?|flats?)\b/g,
  accessories: /\b(hats?|caps?|beanies?|bags?|handbags?|totes?|backpacks?|purses?|belts?|scarves?|scarfs?|gloves?|wallets?|card\s*holders?|jewelry|bracelets?|necklaces?|earrings?)\b/g,
  bottoms: /\b(jeans?|pants?|trousers?|shorts?|skirts?|leggings?|joggers?|chinos?|bottoms?|denim)\b/g,
  tops: /\b(shirts?|tees?|t-shirts?|tops?|sweaters?|hoodies?|jackets?|coats?|blouses?|tanks?|cardigans?|dresses?)\b/g
};

export function inferCategory(value) {
  if (typeof value === "string") {
    return inferCategory({ title: value });
  }

  const fields = [
    { text: value?.title, weight: 8 },
    { text: value?.url, weight: 6 },
    { text: value?.description, weight: 4 },
    { text: value?.pageText, weight: 1 }
  ];
  const scores = { tops: 0, bottoms: 0, shoes: 0, accessories: 0 };

  for (const { text, weight } of fields) {
    const normalized = String(text || "").toLowerCase();
    if (!normalized) continue;

    for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
      const matches = normalized.match(pattern);
      if (matches?.length) {
        scores[category] += matches.length * weight;
      }
    }
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  if (!ranked[0]?.[1]) return "unknown";
  if (ranked[0][1] === ranked[1]?.[1]) return "unknown";
  return ranked[0][0];
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function tableToStructuredData(table) {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => clean(cell.textContent))
  ).filter((row) => row.length);
  const caption = clean(table.querySelector("caption")?.textContent || "");
  const columns = rows[0] || [];
  const dataRows = rows.slice(1).map((row) => rowToObject(columns, row));

  return { caption, columns, rows: dataRows };
}

function rowToObject(columns, row) {
  return row.reduce((record, value, index) => {
    record[columns[index] || `column_${index + 1}`] = value;
    return record;
  }, {});
}

function extractFitSignals(text) {
  const lines = text.split(/\n|(?<=\.)\s+/).map(clean).filter(Boolean);
  const signals = [];

  for (const signal of FIT_SIGNAL_PATTERNS) {
    const line = lines.find((candidate) => signal.pattern.test(candidate));
    if (line) {
      signals.push({ type: signal.type, label: signal.label, text: line.slice(0, 220) });
    }
  }

  return signals;
}

function getText(documentRef, selectors) {
  for (const selector of selectors) {
    const element = documentRef?.querySelector?.(selector);
    const value = element?.getAttribute?.("content") || element?.textContent;
    if (clean(value)) return clean(value);
  }
  return "";
}

function getMeta(documentRef, attribute, value) {
  const element = documentRef?.querySelector?.(`meta[${attribute}='${value}'], meta[${attribute}="${value}"]`);
  return clean(element?.getAttribute?.("content") || "");
}

function getJsonLdValue(documentRef, keys) {
  const scripts = Array.from(documentRef?.querySelectorAll?.("script[type='application/ld+json']") || []);
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent);
      const values = Array.isArray(json) ? json : [json];
      for (const value of values.flatMap(flattenGraph)) {
        for (const key of keys) {
          if (typeof value?.[key] === "string") return clean(value[key]);
        }
      }
    } catch (_error) {
      // Ignore invalid page-owned JSON-LD.
    }
  }
  return "";
}

function getJsonLdBrand(documentRef) {
  const scripts = Array.from(documentRef?.querySelectorAll?.("script[type='application/ld+json']") || []);
  for (const script of scripts) {
    try {
      const json = JSON.parse(script.textContent);
      const values = (Array.isArray(json) ? json : [json]).flatMap(flattenGraph);
      for (const value of values) {
        const brand = value?.brand;
        if (typeof brand === "string") return clean(brand);
        if (typeof brand?.name === "string") return clean(brand.name);
      }
    } catch (_error) {
      // Ignore invalid page-owned JSON-LD.
    }
  }
  return "";
}

function flattenGraph(value) {
  if (Array.isArray(value?.["@graph"])) return value["@graph"];
  return [value];
}

function getVisibleText(documentRef) {
  return cleanMultiline(documentRef?.body?.textContent || "");
}

function findNearbyText(text, keywords) {
  const lines = text.split(/\n/).map(clean).filter(Boolean);
  const index = lines.findIndex((line) => keywords.some((keyword) => line.toLowerCase().includes(keyword)));
  if (index < 0) return "";
  return lines.slice(Math.max(0, index - 1), index + 4).join(" ").slice(0, 500);
}

function firstNonEmpty(values) {
  return values.map(clean).find(Boolean) || "";
}

function uniqueClean(values) {
  return Array.from(new Set(values.map(cleanSize).filter(Boolean)));
}

function dedupeSignals(signals) {
  const seen = new Set();
  return signals.filter((signal) => {
    if (seen.has(signal.type)) return false;
    seen.add(signal.type);
    return true;
  });
}

function isLikelySize(value) {
  const size = cleanSize(value);
  if (!size || /select|choose|size guide|sold out|out of stock|unavailable|notify me|coming soon/i.test(size)) return false;
  if (SIZE_TOKENS.has(size.toUpperCase()) || SIZE_TOKENS.has(size)) return true;
  // Alpha sizes, numeric clothing, waist×inseam, half sizes (e.g. 9.5, 10.5)
  return /^(W?\d{1,2}(?:\s?[x×]\s?\d{1,2})?|\d{1,2}\.\d|[0-9]{1,2}[A-Z]?|XXS|XS|S|M|L|XL|XXL|XXXL|OS|O\/S|ONE SIZE)$/i.test(size);
}

/**
 * Strip sold-out annotations and normalize size strings.
 * Handles many real-world variants:
 *   "XL - Sold Out"      "XL (Sold Out)"    "XL [Sold Out]"
 *   "XL – Sold Out"      "XL / Sold Out"    "XL • Out of Stock"
 *   "Sold Out - XL"      "(Out of Stock) XL"
 *   "EU 42"              "EU42"              "US 10.5"
 */
function cleanSize(value) {
  return clean(value)
    .replace(/\s+/g, " ")
    // Sold-out / unavailable suffixes in various delimiters
    .replace(/[\s\-–—/•]*[\[(]?(sold\s*out|out\s*of\s*stock|unavailable|not\s*available)[\])]?[\s\-–—/•]*/gi, " ")
    // Sold-out / unavailable prefixes
    .replace(/^[\[(]?(sold\s*out|out\s*of\s*stock|unavailable)[\])]?[\s\-–—/•]*/gi, "")
    // Normalize EU/US/UK size prefix ("EU 42" → "42", "US 10.5" → "10.5")
    .replace(/^(?:EU|US|UK)\s*/i, "")
    .replace(/^one size$/i, "ONE SIZE")
    .replace(/^o\/s$/i, "OS")
    .trim();
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanMultiline(value) {
  return String(value ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch (_error) {
    return null;
  }
}

function guessBrandFromTitle(title) {
  const value = String(title || "");
  if (!/[|-]/.test(value)) return "";
  return value.split(/[|-]/)[0]?.trim() || "";
}

function getDebugFlag(options) {
  if (typeof options.debug === "boolean") return options.debug;
  try {
    return globalThis.localStorage?.getItem(DEBUG_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function debugLog(enabled, label, payload) {
  if (enabled) {
    console.debug(`[Fitcheck] ${label}`, payload);
  }
}

function getMetaFromHtml(html, attribute, value) {
  const regex = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(value)}["'])([^>]*)>`, "i");
  const match = html.match(regex);
  return match ? getAttribute(match[0], "content") : "";
}

function getTitleFromHtml(html) {
  return getFirstTagText(html, "title");
}

function getFirstTagText(html, tagName) {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return clean(stripTags(html.match(regex)?.[1] || ""));
}

function getTextByAttributeFromHtml(html, attribute, value) {
  const regex = new RegExp(`<[^>]+\\b${attribute}=["'][^"']*${escapeRegExp(value)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return clean(stripTags(html.match(regex)?.[1] || ""));
}

function getTextByClassFromHtml(html, classPart) {
  return getTextByAttributeFromHtml(html, "class", classPart);
}

function extractSelectOptionsFromHtml(html) {
  const selects = html.match(/<select\b[^>]*(?:name|id|aria-label)=["'][^"']*size[^"']*["'][^>]*>[\s\S]*?<\/select>/gi) || [];
  return selects.flatMap((select) => {
    const options = select.match(/<option\b[^>]*>[\s\S]*?<\/option>/gi) || [];
    return options.map((option) => clean(stripTags(option)));
  });
}

function extractSizeButtonsFromHtml(html) {
  const buttons = html.match(/<(button|label)\b[^>]*(?:class|name|aria-label|data-testid)=["'][^"']*size[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi) || [];
  return buttons.map((button) => clean(stripTags(button)));
}

function extractTablesFromHtml(html) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  return tables.map((table) => {
    const caption = clean(stripTags(table.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || ""));
    const trBlocks = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    const parsedRows = trBlocks.map((row) => {
      const cells = row.match(/<(th|td)\b[\s\S]*?<\/\1>/gi) || [];
      return cells.map((cell) => clean(stripTags(cell)));
    }).filter((row) => row.length);
    const columns = parsedRows[0] || [];
    return { caption, columns, rows: parsedRows.slice(1).map((row) => rowToObject(columns, row)) };
  }).filter((table) => table.columns.length || table.rows.length);
}

function stripTags(value) {
  return String(value ?? "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|section|article|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getAttribute(tag, attribute) {
  const regex = new RegExp(`\\b${attribute}=["']([^"']*)["']`, "i");
  return clean(tag.match(regex)?.[1] || "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
