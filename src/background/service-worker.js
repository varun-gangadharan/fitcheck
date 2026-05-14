import {
  addHistoryRecord,
  getBrandNotes,
  getConfig,
  getHistory,
  getUserProfile,
  updateBrandMemoryFromOutcome
} from "../shared/storage.js";
import { analyzeFit } from "../backend/recommendation-engine.js";
import { normalizeApiUrl } from "../shared/security.js";

const CONTENT_SCRIPT_FILE = "src/content/content-script.js";

// Open the options page on fresh install so users can configure their profile.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FITCHECK_ANALYZE_PRODUCT") {
    analyzeProduct(message.product)
      .then((analysis) => sendResponse({ ok: true, analysis }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FITCHECK_GET_PROFILE") {
    getUserProfile()
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "FITCHECK_SAVE_OUTCOME") {
    saveOutcome(message.record)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message?.type === "FITCHECK_ENSURE_CONTENT_SCRIPT") {
    ensureContentScript(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  return false;
});

async function ensureContentScript(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Missing active tab.");
  }

  try {
    const existing = await chrome.tabs.sendMessage(tabId, { type: "FITCHECK_PING" });
    if (existing?.ok) return;
  } catch (_error) {
    // Content script is not injected yet — continue to injection.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE]
  });
}

async function analyzeProduct(product) {
  try {
    const profile = await getUserProfile();
    const brandMemory = await getBrandNotes();
    const history = await getHistory();
    const config = await getConfig();
    const payload = {
      product,
      profile,
      brandMemory,
      history,
      options: {
        analysisMode: config.analysisMode || "rules_only",
        webEvidenceEnabled: Boolean(config.webEvidenceEnabled),
        searchProvider: config.searchProvider || "firecrawl"
      }
    };

    let analysis;
    try {
      analysis = await requestAnalysis(config.apiUrl, payload, config.apiToken);
    } catch (error) {
      // If the API is unreachable and the mode is rules_only, run the rules
      // engine directly in the service worker so the extension works offline.
      if (isNetworkError(error) && (config.analysisMode || "rules_only") === "rules_only") {
        analysis = runLocalRules({ product, profile, brandMemory, history });
      } else {
        throw error;
      }
    }

    // Strip large transient fields before storing — ai.prompt embeds the full
    // history JSON, causing each record to grow polynomially and hit quota.
    await addHistoryRecord({
      product,
      analysis: stripAnalysisForStorage(analysis),
      outcome: null
    });

    return analysis;
  } catch (error) {
    throw new Error(friendlyError(error));
  }
}

/** Run the rules engine in-process (no API call). Used when API is offline. */
function runLocalRules({ product, profile, brandMemory, history }) {
  const webEvidence = {
    status: "disabled",
    reason: "Running offline — local API is not connected. Start it with npm run api for web evidence and AI analysis.",
    summary: []
  };
  const result = analyzeFit({ product, profile, brandMemory, history, evidenceSignals: [], webEvidence });
  return {
    ...result,
    webEvidence,
    ai: { mode: "rules_only_local" }
  };
}

/**
 * Removes fields that are large and not needed for history/brand-memory
 * purposes: the prompt text, raw web evidence snippets, and the model
 * output blob. Keeps the fields the panel and brand-memory logic actually use.
 */
function stripAnalysisForStorage(analysis) {
  if (!analysis) return analysis;
  const { ai, webEvidence, ...core } = analysis;
  return {
    ...core,
    ai: ai
      ? {
          mode: ai.mode,
          ...(ai.model ? { model: { status: ai.model.status, provider: ai.model.provider } } : {})
        }
      : undefined,
    webEvidence: webEvidence
      ? { status: webEvidence.status, summary: webEvidence.summary || [] }
      : undefined
  };
}

async function saveOutcome(record) {
  const savedRecord = await addHistoryRecord(record);
  const brandNote = await updateBrandMemoryFromOutcome(savedRecord);
  return { record: savedRecord, brandNote };
}

async function requestAnalysis(apiUrl, payload, apiToken) {
  const normalizedApiUrl = normalizeApiUrl(apiUrl);
  const headers = { "content-type": "application/json" };
  if (apiToken) headers["authorization"] = `Bearer ${apiToken}`;

  const response = await fetch(`${normalizedApiUrl}/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    throw new Error(body.message || "Invalid or missing API token. Add your token in Fitcheck options.");
  }
  if (response.status === 429) {
    throw new Error(body.message || "Rate limit reached. Try again later.");
  }
  if (!response.ok) {
    const details = Array.isArray(body.details) ? ` ${body.details.join(" ")}` : "";
    throw new Error(`${body.message || "Analyze request failed."}${details}`);
  }

  return body;
}

function isNetworkError(error) {
  return /Failed to fetch|NetworkError|ERR_CONNECTION|Load failed|net::/i.test(error.message || "");
}

function friendlyError(error) {
  const msg = error.message || "";
  if (/API URL must|Remote API URLs must use https|embedded credentials|query parameters or fragments/i.test(msg)) {
    return msg;
  }
  if (/Cannot access|Cannot inject|Missing host permission|chrome:\/\/|Edge Add-ons/i.test(msg)) {
    return "Fitcheck can only run on normal shopping pages after you open it from the toolbar.";
  }
  // Network / API unreachable — check this FIRST so connection errors are
  // never misclassified as storage errors (both could mention "storage").
  if (isNetworkError(error)) {
    return "Fitcheck could not reach the local API. Run npm run api and check the API URL in options.";
  }
  // Explicit chrome.storage API errors or quota messages
  if (/chrome\.storage\.local is unavailable|QUOTA_BYTES|QuotaExceeded/i.test(msg)) {
    return "Fitcheck could not save locally. Check Chrome storage permissions and try again.";
  }
  return msg || "Fitcheck hit an unexpected error.";
}
