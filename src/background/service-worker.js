import {
  addHistoryRecord,
  getBrandNotes,
  getConfig,
  getHistory,
  getUserProfile,
  updateBrandMemoryFromOutcome
} from "../shared/storage.js";

chrome.runtime.onInstalled.addListener(() => {
  console.info("Fitcheck installed.");
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
      .catch((error) => sendResponse({ ok: false, error: friendlyStorageError(error) }));
    return true;
  }

  return false;
});

async function analyzeProduct(product) {
  try {
    const profile = await getUserProfile();
    const brandMemory = await getBrandNotes();
    const history = await getHistory();
    const config = await getConfig();
    const analysis = await requestAnalysis(config.apiUrl, {
      product,
      profile,
      brandMemory,
      history,
      options: {
        analysisMode: config.analysisMode || "rules_only",
        webEvidenceEnabled: Boolean(config.webEvidenceEnabled),
        searchProvider: config.searchProvider || "firecrawl"
      }
    });

    await addHistoryRecord({
      product,
      analysis,
      outcome: null
    });

    return analysis;
  } catch (error) {
    throw new Error(friendlyStorageError(error));
  }
}

async function saveOutcome(record) {
  const savedRecord = await addHistoryRecord(record);
  const brandNote = await updateBrandMemoryFromOutcome(savedRecord);
  return { record: savedRecord, brandNote };
}

async function requestAnalysis(apiUrl, payload) {
  const response = await fetch(`${String(apiUrl).replace(/\/+$/, "")}/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const details = Array.isArray(body.details) ? ` ${body.details.join(" ")}` : "";
    throw new Error(`${body.message || "Analyze request failed."}${details}`);
  }

  return body;
}

function friendlyStorageError(error) {
  if (/chrome\.storage|QUOTA|storage/i.test(error.message || "")) {
    return "Fitcheck could not save locally. Check Chrome storage permissions and try again.";
  }
  if (/fetch|Failed to fetch|NetworkError/i.test(error.message || "")) {
    return "Fitcheck could not reach the local API. Run npm run api and check the API URL in options.";
  }
  return error.message || "Fitcheck hit an unexpected error.";
}
