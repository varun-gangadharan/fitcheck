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
npm test
npm run validate
npm run build
```

The build script currently validates that required extension files exist. No bundling is required for the MVP scaffold.

## Extraction Fixtures

Static product-page fixtures live in `tests/fixtures`. The extraction tests cover a top product, a bottom product, and a missing-data page to ensure Fitcheck returns a normalized product record without crashing when details are absent.
