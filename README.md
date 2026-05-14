# Fitcheck

Fitcheck is a Chrome extension (Manifest V3) that gives you a personalized size recommendation on fashion product pages. It accesses the current tab only after you open Fitcheck from the Chrome toolbar, extracts product data from that page, runs a local rules engine, optionally gathers web evidence from search APIs, and optionally uses Gemini to review and improve the recommendation.

The extension communicates with a **local Node.js API** that you run yourself on `127.0.0.1`. Your Gemini and search API keys stay on your machine.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Chrome Extension                                    │
│                                                      │
│  content-script.js   — injected on demand into the  │
│                         current tab, panel UI, DOM  │
│                         extraction                   │
│  service-worker.js   — message bus, storage I/O,    │
│                         API calls to local server    │
│  popup.js            — toolbar icon → open panel    │
│  options.js          — user profile + config UI      │
└───────────────────┬─────────────────────────────────┘
                    │ fetch POST /analyze
                    ▼
┌─────────────────────────────────────────────────────┐
│  Local API  (Node.js, 127.0.0.1:8787)                │
│                                                      │
│  server.js                — HTTP server, localhost   │
│                             only (non-local → 403)   │
│  analysis-orchestrator.js — mode routing             │
│  recommendation-engine.js — rules engine             │
│  evidence-service.js      — web search + caching     │
│  model-service.js         — Gemini 2.5 Flash         │
│  prompt-builder.js        — builds analysis prompt   │
│  persistent-store.js      — disk cache (.fitcheck-  │
│                             cache/)                  │
└─────────────────────────────────────────────────────┘
```

**Data flow:**
1. User opens a product page and invokes Fitcheck from the toolbar → Fitcheck injects into the current tab and extracts product, sizes, size chart, and fit signals from the DOM.
2. User clicks **Check sizing** → the service worker reads profile, brand memory, and history from `chrome.storage.local`, then POSTs `/analyze` to the local API.
3. Local API runs the rules engine, optionally fetches web evidence, optionally calls Gemini, and returns a recommendation.
4. Panel displays the recommendation. Marking an outcome (fit / too small / too big / returned) updates brand memory for future analyses.

---

## Prerequisites

- **Node.js** 18+ (the API uses `node:test`, `node:fs`, and ES modules)
- **Chrome** (any recent version)
- A **.env file** in the repo root for API keys (see [Environment Variables](#environment-variables))

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd fitcheck
npm install
```

### 2. Create a .env file

```bash
# .env — copy this and fill in keys you want to use
GEMINI_API_KEY=          # required for model_assisted mode
FIRECRAWL_API_KEY=       # required for rules_plus_web / model_assisted with Firecrawl
BRAVE_SEARCH_API_KEY=    # alternative to Firecrawl
```

All keys are optional for basic usage — the default mode (`rules_only`) needs no keys.

### 3. Start the local API

```bash
npm run api
# Fitcheck API listening on http://127.0.0.1:8787
```

Keep this running while you use the extension.

### 4. Load the extension in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** → select this repo folder
4. Pin Fitcheck from the extensions toolbar
5. Open Fitcheck from the toolbar while viewing a product page to grant current-tab access

### 5. Configure the extension

Open the Fitcheck **Options** page (right-click the icon → Options, or from `chrome://extensions`):

- Set your **usual sizes** (e.g. tops: M, bottoms: 32)
- Choose **analysis mode** (see below)
- Set **fit preference** per category (snug / regular / relaxed)
- Optionally add **exact measurements** for chart-based matching

---

## Analysis Modes

Configure via the Options page or `FITCHECK_ANALYSIS_MODE` env var on the server.

| Mode | What it does | Keys required |
|------|-------------|---------------|
| `rules_only` | Local rules engine only — no external calls | None |
| `rules_plus_web` | Rules engine + web search evidence | Search provider key |
| `model_assisted` | Rules engine + web evidence + Gemini review | Gemini key + search key |

In `model_assisted` mode, Gemini receives the rules engine baseline and is asked to verify or override it using the web evidence. If the Gemini call fails, the rules engine result is returned as-is.

---

## Web Evidence Providers

Web evidence supplements the rules engine with real-world sizing signals from forums, reviews, and Reddit threads.

| Provider | Env var | Notes |
|----------|---------|-------|
| Firecrawl | `FIRECRAWL_API_KEY` | Default provider |
| Brave Search | `BRAVE_SEARCH_API_KEY` | Alternative |

Switch providers in the Options page (Search provider dropdown) or via `FITCHECK_SEARCH_PROVIDER=brave`.

Evidence results are cached in `.fitcheck-cache/evidence-cache.json` for 30 minutes. Rate limiting (20 searches/min per provider) is persisted to `.fitcheck-cache/rate-limit.json` across server restarts.

If web evidence is disabled or a key is missing, `/analyze` still returns a rules-only recommendation with `webEvidence.status: "disabled"` or `"not_configured"`.

---

## Environment Variables

All variables are optional unless you want the corresponding feature.

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | — | Enables `model_assisted` analysis mode |
| `FIRECRAWL_API_KEY` | — | Enables Firecrawl web evidence |
| `BRAVE_SEARCH_API_KEY` | — | Alternative web evidence provider |
| `FITCHECK_API_PORT` | `8787` | Port the local API listens on |
| `FITCHECK_API_HOST` | `127.0.0.1` | Host the local API binds to |
| `FITCHECK_ANALYSIS_MODE` | `rules_only` | Default mode if not set by extension |
| `FITCHECK_SEARCH_PROVIDER` | `firecrawl` | Default search provider |

The server loads `.env` from the repo root automatically. Never put API keys in the extension itself — the extension has no access to them by design.

By default, the local API running on `127.0.0.1` does not require an API token. If you want to protect a shared or hosted deployment, set `FITCHECK_REQUIRE_API_TOKEN=true` and distribute Bearer tokens separately.

---

## Chrome Web Store privacy posture

- Fitcheck uses `activeTab` and `scripting`, so it only reads page content from the current tab after the user opens the extension.
- User profile, history, and brand-memory data are stored locally in `chrome.storage.local`.
- If the user enables optional web evidence or model-assisted mode, the local API may send product and profile context to the provider they configured.
- Fitcheck does not sell data, run ads, or collect background browsing activity.

---

## Security Model

- The extension injects only after explicit user invocation from the toolbar.
- The local API binds to `127.0.0.1` by default and rejects non-local socket connections.
- Browser-origin requests to the local API are limited by default to Chrome extension origins and localhost origins.
- You can explicitly lock CORS to one or more published origins with `FITCHECK_ALLOWED_ORIGIN`.
- Remote API endpoints must use `https://`. Plain `http://` is only allowed for localhost.
- The local API does not require a Bearer token by default for personal localhost use. To protect a shared or hosted deployment, set `FITCHECK_REQUIRE_API_TOKEN=true`.
- Request bodies are capped to reduce memory-abuse risk.
- Local token and cache files are written with restrictive filesystem permissions where supported by the OS.

---

## Local Persistence

### chrome.storage.local (extension)

| Key | Contents |
|-----|----------|
| `fitcheck:userProfile` | Mode, usual sizes, fit preferences, measurements |
| `fitcheck:config` | API URL, analysis mode, search provider |
| `fitcheck:brandNotes` | Per-brand sizing memory, updated from outcomes |
| `fitcheck:history` | Last 50 analysis records (stripped of large fields) |
| `fitcheck:analysisResults` | Last 50 full result records |

Marking an outcome (fit / too small / too big / returned) writes to `brandNotes` so future analyses for the same brand automatically bias size and risk.

### .fitcheck-cache/ (server)

Created automatically next to the repo root.

| File | Contents | TTL |
|------|----------|-----|
| `evidence-cache.json` | Web evidence keyed by provider:brand:category:title | 30 min |
| `rate-limit.json` | Per-provider search timestamps for rate limiting | Rolling 60s |

---

## Product Extraction

Fitcheck extracts product data from pages automatically. It handles:

- **Standard HTML** — `<table>` size charts, `<select>` dropdowns, `<input type="radio">` buttons
- **Shopify classic** — radio inputs (`name="Size"`), Shopify product JSON script tags
- **Shopify Hydrogen/React** — `optionValues` and `variants` JSON in inline scripts, `sizeGuideTable` JSON from Remix streaming
- **WooCommerce** — `pa_size` variation selects
- **Div-based charts** — grid containers with class names matching `size-chart`, `measurement`, `sizing-guide`, or implicit grid structures near measurement keywords (LENGTH, CHEST, WAIST, SLEEVE, etc.)
- **URL pattern detection** — `/products/`, `/product/`, `/item/` paths are treated as product pages even if other signals are missing

---

## Testing

### Unit tests

```bash
npm test
```

Runs all tests in `tests/*.test.mjs` using Node's built-in test runner. No extra dependencies required beyond `node_modules`.

**Test suites:**

| File | What it covers |
|------|---------------|
| `accuracy.test.mjs` | 15 rules-engine scenarios with known correct answers |
| `analysis-orchestrator.test.mjs` | Mode routing, Gemini fallback, response shape |
| `api-validation.test.mjs` | Request validation for POST /analyze |
| `evidence-service.test.mjs` | Cache hits/misses, disk persistence, rate limiting, corrupt file handling |
| `extract-product.test.mjs` | Product extraction across 8 fixture pages (Shopify, Hydrogen, WooCommerce, numeric sizes, missing data) |
| `recommendation-engine.test.mjs` | Rules engine signals, measurements, bias, prompt builder |

### Smoke test (end-to-end)

Requires Chrome to be installed. Launches a real Chrome instance with the extension loaded, runs a full analysis flow, and verifies the outcome is saved.

```bash
npm run test:smoke
```

The smoke test uses a mock API server (port 9788) and a fixture server (port 9789) — no real API keys or network calls needed.

### Validate extension files

```bash
npm run validate
# or
npm run build
```

Checks that all required extension files exist and that `manifest.json` is Manifest V3.

---

## API Reference

### POST /analyze

Request body:

```json
{
  "product": {
    "url": "https://shop.example/products/item",
    "brand": "Acme",
    "title": "Cotton Shirt",
    "category": "tops",
    "sizeOptions": ["S", "M", "L", "XL"],
    "sizeChart": { "sourceText": "...", "tables": [] },
    "fitSignals": [{ "type": "runs_small", "label": "Runs small", "text": "..." }],
    "extractedSignals": { "missingFields": [] }
  },
  "profile": {
    "mode": "lightweight",
    "usualSizes": { "tops": "M", "bottoms": "32" },
    "fitPreference": { "tops": "regular", "bottoms": "regular" },
    "measurements": {}
  },
  "brandMemory": [],
  "history": [],
  "options": {
    "analysisMode": "rules_only",
    "webEvidenceEnabled": false,
    "searchProvider": "firecrawl"
  }
}
```

Response (rules_only example):

```json
{
  "suggestedSize": "M",
  "backupSize": "L",
  "confidence": 0.72,
  "riskScore": 28,
  "explanation": "Buy M. ...",
  "evidenceSnippets": ["..."],
  "ruleSignals": [{ "id": "structured_size_chart", "impact": -6, "message": "..." }],
  "webEvidence": { "status": "disabled", "reason": "...", "summary": [] },
  "ai": { "mode": "rules_only", "prompt": { "system": "...", "user": "..." } },
  "timestamp": "2026-05-11T..."
}
```

---

## Adding a New Test Fixture

1. Save a product page's HTML to `tests/fixtures/your-page.html` (strip scripts if needed, keep the product data section)
2. Add a test to `tests/extract-product.test.mjs` using `extractProductFromHtml(await fixture("your-page.html"), { url: "..." })`
3. Assert the fields you care about

The extraction functions work on raw HTML without a browser — no Puppeteer required for unit tests.

---

## Project Structure

```
fitcheck/
├── manifest.json
├── src/
│   ├── backend/           # Local Node.js API (not bundled into extension)
│   │   ├── server.js
│   │   ├── analysis-orchestrator.js
│   │   ├── recommendation-engine.js
│   │   ├── evidence-service.js
│   │   ├── model-service.js
│   │   ├── prompt-builder.js
│   │   ├── persistent-store.js
│   │   ├── validation.js
│   │   └── env.js
│   ├── background/
│   │   └── service-worker.js  # Message bus, storage, API proxy
│   ├── content/
│   │   ├── content-script.js  # Panel UI (injected on demand into the current tab)
│   │   └── panel.css
│   ├── popup/
│   │   ├── popup.html/js/css  # Toolbar icon popup
│   ├── options/
│   │   ├── options.html/js/css  # Settings + profile
│   └── shared/
│       ├── config.js          # Defaults, mode IDs
│       ├── models.js          # Types, storage keys, schema version
│       ├── storage.js         # chrome.storage wrappers
│       ├── extract-product.js # DOM + HTML extraction (web-accessible)
│       └── mock-analysis.js   # Dev fixture
├── tests/
│   ├── fixtures/              # HTML pages for extraction tests
│   ├── *.test.mjs             # Unit tests (node --test)
│   └── smoke/                 # End-to-end Puppeteer test
└── scripts/
    └── validate-extension.mjs
```
