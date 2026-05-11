import { DEFAULT_CACHE_DIR, createNullStore, createStore } from "./persistent-store.js";

const CACHE_TTL_MS = 1000 * 60 * 30;
const MAX_SEARCHES_PER_MINUTE = 20;

// In-memory state — hydrated from disk by initEvidenceStore(), used every run.
const cache = new Map();
const recentSearchesByProvider = {}; // { [provider]: number[] }

// Active persistence store — null-op until initEvidenceStore() is called.
let activeStore = createNullStore();

const SIGNAL_PATTERNS = [
  { signal: "runsSmall", engineType: "runs_small", pattern: /\bruns?\s+small\b|\bfit(?:s)?\s+small\b/i },
  { signal: "runsLarge", engineType: "runs_large", pattern: /\bruns?\s+large\b|\bfit(?:s)?\s+large\b/i },
  { signal: "trueToSize", engineType: "true_to_size", pattern: /\btrue\s+to\s+size\b|\btts\b/i },
  { signal: "sizeUp", engineType: "runs_small", pattern: /\bsize\s+up\b|\bgo\s+up\b|\border\s+up\b/i },
  { signal: "sizeDown", engineType: "runs_large", pattern: /\bsize\s+down\b|\bgo\s+down\b|\border\s+down\b/i },
  { signal: "inconsistent", engineType: "inconsistent", pattern: /\binconsistent\b|\bvaries\b|\bmixed\b|\bhit\s+or\s+miss\b/i }
];

/**
 * Switch to file-backed persistence and hydrate in-memory state from disk.
 * Call once at server startup. Safe to call again (replaces the active store).
 *
 * @param {string} [dirPath] - Directory for cache files. Defaults to DEFAULT_CACHE_DIR.
 */
export function initEvidenceStore(dirPath = DEFAULT_CACHE_DIR) {
  // Reset in-memory state so stale entries from a previous store don't carry over.
  cache.clear();
  for (const key of Object.keys(recentSearchesByProvider)) {
    delete recentSearchesByProvider[key];
  }

  const store = createStore(dirPath);
  activeStore = store;

  // Hydrate cache from disk.
  const savedCache = store.readCache();
  for (const [key, entry] of Object.entries(savedCache)) {
    if (entry && typeof entry.cachedAt === "number") {
      cache.set(key, entry);
    }
  }

  // Hydrate rate-limit state, dropping timestamps outside the 1-minute window.
  const savedRateLimit = store.readRateLimit();
  const cutoff = Date.now() - 60_000;
  for (const [provider, timestamps] of Object.entries(savedRateLimit)) {
    if (Array.isArray(timestamps)) {
      recentSearchesByProvider[provider] = timestamps.filter((t) => t > cutoff);
    }
  }
}

export async function gatherEvidence(product, options = {}) {
  const provider = options.provider || process.env.FITCHECK_SEARCH_PROVIDER || "firecrawl";
  const apiKey = options.apiKey || providerApiKey(provider);
  const queries = buildSearchQueries(product);

  if (!options.enabled) {
    return emptyEvidence("Web evidence is turned off in Fitcheck settings.", queries, "disabled");
  }

  if (!apiKey || provider === "none") {
    return emptyEvidence(`No ${provider} search provider API key is configured.`, queries, "not_configured");
  }

  if (isRateLimited(provider)) {
    return emptyEvidence("Search rate limit reached. Using product-page evidence only.", queries);
  }

  const cacheKey = `${provider}:${product.brand}:${product.category}:${product.title}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { ...cached.value, cache: { hit: true, ttlMs: CACHE_TTL_MS } };
  }

  const results = [];
  for (const query of queries) {
    const searchResults = await searchProvider({ provider, apiKey, query });
    results.push(...searchResults.map((result) => ({ ...result, query })));
  }

  const snippets = compactSnippets(results);
  const classified = classifyEvidence(snippets);
  const value = {
    status: snippets.length ? "ok" : "insufficientEvidence",
    reason: snippets.length ? "" : "Search provider returned no usable snippets.",
    provider,
    queries,
    snippets,
    signals: classified.signals,
    summary: classified.summary,
    cache: { hit: false, ttlMs: CACHE_TTL_MS }
  };

  const entry = { cachedAt: Date.now(), value };
  cache.set(cacheKey, entry);
  persistCache();

  return value;
}

export function buildSearchQueries(product) {
  const brand = product.brand || product.title || "fashion item";
  const itemType = inferItemType(product);
  const category = product.category || "clothing";
  const title = product.title || "";

  // Use the specific product title when it adds signal beyond brand + itemType.
  const productTerm = title && !title.toLowerCase().includes(brand.toLowerCase())
    ? title
    : `${brand} ${itemType}`;

  return [
    `${productTerm} sizing runs small`,
    `${brand} ${itemType} size up`,
    `${brand} true to size`,
    `${productTerm} fit review reddit`,
    `${brand} sizing reddit`
  ];
}

export function classifyEvidence(snippets) {
  const counts = new Map();
  const signals = [];

  for (const snippet of snippets) {
    const text = `${snippet.title || ""} ${snippet.snippet || ""}`;
    for (const pattern of SIGNAL_PATTERNS) {
      if (pattern.pattern.test(text)) {
        counts.set(pattern.signal, (counts.get(pattern.signal) || 0) + 1);
        signals.push({
          type: pattern.engineType,
          signal: pattern.signal,
          source: snippet.source,
          url: snippet.url,
          text: snippet.snippet,
          query: snippet.query
        });
      }
    }
  }

  if (!signals.length) {
    return {
      signals: [{ signal: "insufficientEvidence", type: "insufficient_evidence", text: "No sizing signal found in search snippets." }],
      summary: ["Search found sources, but none had clear sizing language."]
    };
  }

  const hasSmall = counts.has("runsSmall") || counts.has("sizeUp");
  const hasLarge = counts.has("runsLarge") || counts.has("sizeDown");
  if (hasSmall && hasLarge && !signals.some((signal) => signal.signal === "inconsistent")) {
    signals.push({
      type: "inconsistent",
      signal: "inconsistent",
      source: "classifier",
      url: "",
      text: "Search snippets include both size-up and size-down signals."
    });
  }

  return {
    signals,
    summary: buildEvidenceSummary(counts, signals)
  };
}

function buildEvidenceSummary(counts, signals) {
  const summary = [];
  const count = (name) => counts.get(name) || 0;

  if (count("trueToSize")) {
    summary.push(`${count("trueToSize")} source${count("trueToSize") === 1 ? "" : "s"} say true to size.`);
  }
  if (count("runsSmall") || count("sizeUp")) {
    const total = count("runsSmall") + count("sizeUp");
    summary.push(`${total} source${total === 1 ? "" : "s"} suggest sizing up or that it runs small.`);
  }
  if (count("runsLarge") || count("sizeDown")) {
    const total = count("runsLarge") + count("sizeDown");
    summary.push(`${total} source${total === 1 ? "" : "s"} suggest sizing down or that it runs large.`);
  }
  if (signals.some((signal) => signal.signal === "inconsistent")) {
    summary.push("Sizing evidence is mixed across sources.");
  }
  return summary;
}

async function searchProvider({ provider, apiKey, query }) {
  if (provider === "firecrawl") {
    return searchFirecrawl({ apiKey, query });
  }

  if (provider === "brave") {
    return searchBrave({ apiKey, query });
  }

  if (provider !== "brave") {
    return [];
  }
}

async function searchBrave({ apiKey, query }) {
  noteSearch("brave");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Search provider failed with ${response.status}.`);
  }

  const body = await response.json();
  return (body.web?.results || []).map((result) => ({
    title: clean(result.title),
    snippet: clean(result.description),
    url: result.url,
    source: sourceFromUrl(result.url)
  }));
}

async function searchFirecrawl({ apiKey, query }) {
  noteSearch("firecrawl");
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query,
      limit: 5,
      sources: ["web"],
      country: "US",
      timeout: 30000
    })
  });

  if (!response.ok) {
    throw new Error(`Firecrawl search failed with ${response.status}.`);
  }

  const body = await response.json();
  if (body.success === false) {
    throw new Error(body.error || "Firecrawl search failed.");
  }

  return (body.data?.web || []).map((result) => ({
    title: clean(result.title),
    snippet: clean(result.description || result.markdown),
    url: result.url,
    source: sourceFromUrl(result.url)
  }));
}

function compactSnippets(results) {
  const seen = new Set();
  return results
    .map((result) => ({
      ...result,
      title: cleanResultText(result.title),
      snippet: cleanResultText(result.snippet)
    }))
    .filter((result) => result.url && result.snippet && isUsefulEvidenceResult(result))
    .filter((result) => {
      const key = `${result.url}:${result.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function isUsefulEvidenceResult(result) {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  if (/youtube|video|products?\)|shop classic|new arrivals|sale/.test(text)) return false;
  return /size|sizing|fit|fits|runs|tts|small|large|review|reddit|forum/.test(text);
}

function emptyEvidence(reason, queries, status = "not_configured") {
  return {
    status,
    reason,
    provider: "none",
    queries,
    snippets: [],
    signals: [{ signal: "insufficientEvidence", type: "insufficient_evidence", text: reason }],
    summary: [reason],
    cache: { hit: false, ttlMs: CACHE_TTL_MS }
  };
}

function providerApiKey(provider) {
  if (provider === "firecrawl") return process.env.FIRECRAWL_API_KEY || "";
  if (provider === "brave") return process.env.BRAVE_SEARCH_API_KEY || "";
  return "";
}

function isRateLimited(provider) {
  const now = Date.now();
  const timestamps = recentSearchesByProvider[provider] || [];
  const recent = timestamps.filter((t) => now - t < 60_000);
  recentSearchesByProvider[provider] = recent;
  return recent.length >= MAX_SEARCHES_PER_MINUTE;
}

function noteSearch(provider) {
  if (!recentSearchesByProvider[provider]) {
    recentSearchesByProvider[provider] = [];
  }
  recentSearchesByProvider[provider].push(Date.now());
  persistRateLimit();
}

function persistCache() {
  const obj = {};
  for (const [key, entry] of cache.entries()) {
    obj[key] = entry;
  }
  activeStore.writeCache(obj);
}

function persistRateLimit() {
  activeStore.writeRateLimit({ ...recentSearchesByProvider });
}

function inferItemType(product) {
  const title = String(product.title || "").toLowerCase();
  const match = title.match(/\b(shirt|tee|t-shirt|jean|pant|trouser|short|skirt|dress|hoodie|sweater|jacket|coat|top|legging)\b/);
  if (match) return match[1];
  if (product.category === "bottoms") return "bottoms";
  if (product.category === "tops") return "top";
  return "clothing";
}

function sourceFromUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return host.includes("reddit.com") ? "reddit" : host;
  } catch (_error) {
    return "web";
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanResultText(value) {
  return clean(value)
    .replace(/\s*[-|]\s*(Reddit|YouTube|TikTok|Pinterest)$/i, "")
    .replace(/https?:\/\/\S+/g, "")
    .slice(0, 220);
}
