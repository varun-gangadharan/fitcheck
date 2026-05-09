const CACHE_TTL_MS = 1000 * 60 * 30;
const MAX_SEARCHES_PER_MINUTE = 20;
const cache = new Map();
const recentSearches = [];

const SIGNAL_PATTERNS = [
  { signal: "runsSmall", engineType: "runs_small", pattern: /\bruns?\s+small\b|\bfit(?:s)?\s+small\b/i },
  { signal: "runsLarge", engineType: "runs_large", pattern: /\bruns?\s+large\b|\bfit(?:s)?\s+large\b/i },
  { signal: "trueToSize", engineType: "true_to_size", pattern: /\btrue\s+to\s+size\b|\btts\b/i },
  { signal: "sizeUp", engineType: "runs_small", pattern: /\bsize\s+up\b|\bgo\s+up\b|\border\s+up\b/i },
  { signal: "sizeDown", engineType: "runs_large", pattern: /\bsize\s+down\b|\bgo\s+down\b|\border\s+down\b/i },
  { signal: "inconsistent", engineType: "inconsistent", pattern: /\binconsistent\b|\bvaries\b|\bmixed\b|\bhit\s+or\s+miss\b/i }
];

export async function gatherEvidence(product, options = {}) {
  const provider = options.provider || process.env.FITCHECK_SEARCH_PROVIDER || "brave";
  const apiKey = options.apiKey || process.env.BRAVE_SEARCH_API_KEY || "";
  const queries = buildSearchQueries(product);

  if (!apiKey || provider === "none") {
    return emptyEvidence("No search provider is configured.", queries);
  }

  if (isRateLimited()) {
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

  cache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

export function buildSearchQueries(product) {
  const brand = product.brand || product.title || "fashion item";
  const itemType = inferItemType(product);
  const category = product.category || "clothing";

  return [
    `${brand} ${itemType} runs small`,
    `${brand} ${category} size up`,
    `${brand} true to size`,
    `${brand} fit thread`,
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
      summary: ["Search returned snippets, but none had clear sizing language."]
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
  for (const [signal, count] of counts.entries()) {
    summary.push(`${signal}: ${count} snippet${count === 1 ? "" : "s"}`);
  }
  if (signals.some((signal) => signal.signal === "inconsistent")) {
    summary.push("inconsistent: conflicting sizing claims detected");
  }
  return summary;
}

async function searchProvider({ provider, apiKey, query }) {
  if (provider !== "brave") {
    return [];
  }

  noteSearch();
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

function compactSnippets(results) {
  const seen = new Set();
  return results
    .filter((result) => result.url && result.snippet)
    .filter((result) => {
      const key = `${result.url}:${result.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function emptyEvidence(reason, queries) {
  return {
    status: "not_configured",
    reason,
    provider: "none",
    queries,
    snippets: [],
    signals: [{ signal: "insufficientEvidence", type: "insufficient_evidence", text: reason }],
    summary: [reason],
    cache: { hit: false, ttlMs: CACHE_TTL_MS }
  };
}

function isRateLimited() {
  const now = Date.now();
  while (recentSearches.length && now - recentSearches[0] > 60_000) {
    recentSearches.shift();
  }
  return recentSearches.length >= MAX_SEARCHES_PER_MINUTE;
}

function noteSearch() {
  recentSearches.push(Date.now());
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
