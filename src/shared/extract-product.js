import { EMPTY_PRODUCT_RECORD } from "./models.js";

const DEBUG_STORAGE_KEY = "fitcheck:debug";
const SIZE_TOKENS = new Set([
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "0",
  "2",
  "4",
  "6",
  "8",
  "10",
  "12",
  "14",
  "16",
  "18",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "36",
  "38",
  "40"
]);

const FIT_SIGNAL_PATTERNS = [
  { type: "runs_small", label: "Runs small", pattern: /\bruns?\s+small\b|\bsize\s+up\b/i },
  { type: "runs_large", label: "Runs large", pattern: /\bruns?\s+large\b|\bsize\s+down\b/i },
  { type: "true_to_size", label: "True to size", pattern: /\btrue\s+to\s+size\b|\btts\b/i },
  { type: "oversized", label: "Oversized", pattern: /\boversi[sz]ed\b/i },
  { type: "slim_fit", label: "Slim fit", pattern: /\bslim\s+fit\b|\btailored\s+fit\b/i },
  { type: "relaxed_fit", label: "Relaxed fit", pattern: /\brelaxed\s+fit\b|\bloose\s+fit\b/i },
  { type: "stretch", label: "Stretch", pattern: /\bstretch\b|\belastane\b|\bspandex\b/i },
  { type: "non_stretch", label: "Non-stretch", pattern: /\bnon[-\s]?stretch\b|\bno\s+stretch\b/i }
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
  const category = inferCategory(`${title} ${getMeta(documentRef, "name", "description")} ${pageText.slice(0, 1200)}`);
  const hasAddToCart = Boolean(
    documentRef?.querySelector?.("button[name*='add' i], button[id*='add' i], [aria-label*='add to cart' i], [aria-label*='add to bag' i]")
  );
  const product = normalizeProductRecord({
    url,
    brand,
    title,
    category,
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
  const sizeOptions = uniqueClean([
    ...extractSelectOptionsFromHtml(html),
    ...extractSizeButtonsFromHtml(html)
  ]).filter(isLikelySize);
  const sizeChart = {
    sourceText: findNearbyText(pageText, SIZE_CHART_KEYWORDS),
    tables: extractTablesFromHtml(html)
  };
  const product = normalizeProductRecord({
    url: options.url || "",
    brand,
    title,
    category: inferCategory(`${title} ${pageText.slice(0, 1200)}`),
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
    category: ["tops", "bottoms", "unknown"].includes(product.category) ? product.category : "unknown",
    sizeOptions: uniqueClean(product.sizeOptions),
    fitSignals: dedupeSignals(product.fitSignals),
    extractedSignals: {
      ...product.extractedSignals,
      missingFields
    }
  };
}

export function looksLikeProductPage(documentRef = globalThis.document) {
  const text = getVisibleText(documentRef).toLowerCase();
  return /add to cart|add to bag|size chart|size guide|select size|choose a size/.test(text);
}

const SIZE_CHART_KEYWORDS = ["size chart", "size guide", "measurements", "waist", "inseam", "chest", "bust", "hips"];
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
    "input[name*='size' i]"
  ];
  const values = [];

  for (const selector of selectors) {
    documentRef?.querySelectorAll?.(selector).forEach((element) => {
      const value = element.value || element.getAttribute("value") || element.getAttribute("aria-label") || element.textContent;
      values.push(cleanSize(value));
    });
  }

  return uniqueClean(values).filter(isLikelySize);
}

function extractSizeChartFromDocument(documentRef, pageText) {
  const tables = Array.from(documentRef?.querySelectorAll?.("table") || [])
    .map(tableToStructuredData)
    .filter((table) => table.columns.length || table.rows.length);

  const nearby = findNearbyText(pageText, SIZE_CHART_KEYWORDS);

  return {
    sourceText: nearby,
    tables
  };
}

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

export function inferCategory(value) {
  const lower = String(value).toLowerCase();
  if (/\b(jean|pant|trouser|short|skirt|legging|jogger|chino|bottom)\b/.test(lower)) {
    return "bottoms";
  }
  if (/\b(shirt|tee|t-shirt|top|sweater|hoodie|jacket|coat|blouse|tank|cardigan|dress)\b/.test(lower)) {
    return "tops";
  }
  return "unknown";
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
  if (!size || /select|choose|size guide|sold out|unavailable/i.test(size)) return false;
  if (SIZE_TOKENS.has(size.toUpperCase())) return true;
  return /^(W?\d{1,2}(?:\s?x\s?\d{1,2})?|[0-9]{1,2}[A-Z]?|XXS|XS|S|M|L|XL|XXL|XXXL)$/i.test(size);
}

function cleanSize(value) {
  return clean(value).replace(/\s+/g, " ").replace(/\s+-\s+sold out/i, "");
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
