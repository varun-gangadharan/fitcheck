import { addHistoryRecord, getUserProfile } from "../shared/storage.js";
import { createMockAnalysis } from "../shared/mock-analysis.js";

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
    addHistoryRecord(message.record)
      .then((record) => sendResponse({ ok: true, record }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function analyzeProduct(product) {
  const profile = await getUserProfile();
  const analysis = createMockAnalysis(product, profile);

  await addHistoryRecord({
    product,
    analysis,
    outcome: null
  });

  return analysis;
}
