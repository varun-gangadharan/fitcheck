/**
 * Fitcheck browser smoke test
 *
 * Launches Chrome with the unpacked extension, navigates to a local fixture page,
 * opens the panel, runs Analyze against a mock API, saves a fit outcome, and
 * verifies the panel confirms the save via UI state.
 *
 * Requires a visible display (headful Chrome). Not suitable for headless CI.
 * Run: npm run test:smoke
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import puppeteer from "puppeteer";
import { startMockApi } from "./mock-api.mjs";
import { startFixtureServer } from "./fixture-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../../");
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const MOCK_API_PORT = 9788;
const FIXTURE_PORT = 9789;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/top-product.html`;

// Evaluate an expression in the extension service worker's real execution context
// using a raw CDP session so chrome.* APIs are available.
async function swEval(swTarget, expression) {
  const session = await swTarget.createCDPSession();
  try {
    const result = await session.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "SW eval threw");
    }
    return result.result.value;
  } finally {
    await session.detach();
  }
}

test("fitcheck smoke: panel → analyze → save outcome", { timeout: 90_000 }, async () => {
  const [mockApiServer, fixtureServer] = await Promise.all([
    startMockApi(MOCK_API_PORT),
    startFixtureServer(FIXTURE_PORT, FIXTURES_DIR)
  ]);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-sandbox",
        "--window-size=1280,900"
      ]
    });

    // Wait for the extension service worker to register
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
      { timeout: 20_000 }
    );
    assert.ok(swTarget, "Extension service worker not found");

    // Extract the extension ID from the SW URL
    const extensionId = new URL(swTarget.url()).hostname;

    // Configure the extension via the options page (runs in the real extension context)
    const optionsPage = await browser.newPage();
    await optionsPage.goto(
      `chrome-extension://${extensionId}/src/options/options.html`,
      { waitUntil: "domcontentloaded" }
    );
    await optionsPage.evaluate((apiUrl) => {
      document.querySelector("input[name='apiUrl']").value = apiUrl;
      const radio = document.querySelector("input[name='analysisMode'][value='rules_only']");
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
      document.getElementById("profile-form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    }, `http://127.0.0.1:${MOCK_API_PORT}`);

    // Give storage a moment to flush
    await new Promise((r) => setTimeout(r, 600));
    await optionsPage.close();

    // Open the fixture product page
    const page = await browser.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });

    // Wait for the content script's async extractor to finish
    await page.waitForFunction(
      () => document.documentElement.dataset.fitcheckProductPage === "true",
      { timeout: 15_000 }
    );

    // Send FITCHECK_TOGGLE_PANEL to the tab via the service worker CDP session
    const tabId = await swEval(
      swTarget,
      `(async () => {
        const tabs = await chrome.tabs.query({ url: "${FIXTURE_URL}" });
        return tabs[0]?.id ?? null;
      })()`
    );
    assert.ok(tabId !== null, `Could not find tab for ${FIXTURE_URL}`);

    await swEval(
      swTarget,
      `chrome.tabs.sendMessage(${tabId}, { type: "FITCHECK_TOGGLE_PANEL" })`
    );

    // 1. panel opens and shows the extracted product title
    await page.waitForSelector("#fitcheck-panel-root", { timeout: 8_000 });
    const heading = await page.$eval(
      "#fitcheck-panel-root h2",
      (el) => el.textContent.trim()
    );
    assert.equal(heading, "Boxy Oxford Shirt", "Panel heading should show extracted product title");

    // 2. click Analyze — wait for the outcome buttons to appear
    const analyzeBtn = await page.waitForSelector(
      "[data-fitcheck-analyze]:not([disabled])",
      { timeout: 5_000 }
    );
    await analyzeBtn.click();

    await page.waitForSelector("[data-fitcheck-outcome='fit']", { timeout: 15_000 });

    const suggestedSize = await page.$eval(
      ".fitcheck-panel__hero-size",
      (el) => el.textContent.trim()
    );
    assert.equal(suggestedSize, "M", "Suggested size should match mock API response");

    // 3. save outcome — note: button text flips to "Saved" before the async sendMessage
    //    completes, so we poll storage until the write lands rather than waiting a fixed delay.
    const fitBtn = await page.$("[data-fitcheck-outcome='fit']");
    await fitBtn.click();

    // Poll chrome.storage.local (via SW CDP) until a record with outcome='fit' appears
    const POLL_TIMEOUT = 10_000;
    const POLL_INTERVAL = 400;
    const deadline = Date.now() + POLL_TIMEOUT;
    let history = [];

    while (Date.now() < deadline) {
      const historyJson = await swEval(
        swTarget,
        `(async () => {
          const result = await new Promise(resolve =>
            chrome.storage.local.get("fitcheck:history", resolve)
          );
          return JSON.stringify(result["fitcheck:history"] ?? []);
        })()`
      );
      history = JSON.parse(historyJson);
      if (history.some((r) => r.outcome === "fit")) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    const fitRecord = history.find((r) => r.outcome === "fit");
    assert.ok(fitRecord, "A record with outcome='fit' should exist in storage");
    assert.equal(
      fitRecord.product?.title,
      "Boxy Oxford Shirt",
      "Record should reference the correct product"
    );
    assert.ok(fitRecord.analysis?.suggestedSize, "Record should include the analysis suggestion");

  } finally {
    await browser?.close();
    await Promise.all([
      new Promise((r) => mockApiServer.close(r)),
      new Promise((r) => fixtureServer.close(r))
    ]);
  }
});
