# Fitcheck

Fitcheck is a Manifest V3 Chrome extension MVP for personalized fashion fit recommendations. The current scaffold includes a content script, floating utility panel, popup, options page, background service worker, shared storage helpers, and shared domain models.

The analysis flow is mocked for now. Product extraction uses simple page heuristics and returns placeholder recommendation data.

## Load Unpacked In Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repo folder: `/Users/Varun/fitcheck`.
5. Pin Fitcheck from the extensions menu.
6. Open a fashion product page and click the extension icon.
7. Click **Open panel** to inject the floating utility panel into the active page.

## Local Scripts

```bash
npm run api
npm test
npm run validate
npm run build
```

The build script currently validates that required extension files exist. No bundling is required for the MVP scaffold.

## Local API

Run the backend API before using Analyze in the extension:

```bash
npm run api
```

The API listens at `http://localhost:8787` by default and exposes `POST /analyze`. You can change the extension's API URL from the Fitcheck options page. The API runs rules-only unless an AI integration is added later; `OPENAI_API_KEY` is not required.

Optional web evidence uses Brave Search if configured:

```bash
BRAVE_SEARCH_API_KEY=your_key npm run api
```

If no search provider is configured, `/analyze` returns a clear `webEvidence.status` of `not_configured` and still produces a rules-only recommendation from extracted page data, profile, history, and brand memory.

## Local Persistence

Fitcheck uses `chrome.storage.local` for profile, API URL, brand notes, analysis history, saved analysis results, and outcome feedback. Marking an item as fit, too small, too big, or returned updates brand memory so later analyses can bias sizing and risk.

## Extraction Fixtures

Static product-page fixtures live in `tests/fixtures`. The extraction tests cover a top product, a bottom product, and a missing-data page to ensure Fitcheck returns a normalized product record without crashing when details are absent.
