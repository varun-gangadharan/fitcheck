const elements = {
  pageState: document.getElementById("page-state"),
  title: document.getElementById("product-title"),
  brand: document.getElementById("product-brand"),
  status: document.getElementById("status"),
  openPanel: document.getElementById("open-panel"),
  openOptions: document.getElementById("open-options"),
  setupBanner: document.getElementById("setup-banner"),
  setupBtn: document.getElementById("setup-btn"),
  lastResult: document.getElementById("last-result"),
  resultSize: document.getElementById("result-size"),
  resultConfidence: document.getElementById("result-confidence"),
  resultProduct: document.getElementById("result-product")
};

let activeTabId = null;
let activeTabUrl = "";

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;
  activeTabUrl = tab?.url || "";

  // Load profile + last analysis concurrently
  const [, storageValues] = await Promise.all([
    activeTabId && isSupportedPage(activeTabUrl) ? refreshProduct() : Promise.resolve(),
    chrome.storage.local.get(["fitcheck:userProfile", "fitcheck:analysisResults"])
  ]);

  if (!activeTabId || !isSupportedPage(activeTabUrl)) {
    setStatus("Open a normal shopping page to use Fitcheck.");
    elements.pageState.textContent = "No page";
    elements.openPanel.disabled = true;
  }

  const profile = storageValues["fitcheck:userProfile"];
  const results = storageValues["fitcheck:analysisResults"];

  // Show setup banner if the profile has never been explicitly saved
  if (!profile?.updatedAt) {
    elements.setupBanner.hidden = false;
  }

  // Show last analysis result if available
  if (results?.length) {
    const latest = results[0];
    const size = latest.analysis?.suggestedSize;
    const confidence = latest.analysis?.confidence;
    const brand = latest.product?.brand || "";
    const title = latest.product?.title || "";
    if (size) {
      elements.resultSize.textContent = `Size ${size}`;
      elements.resultConfidence.textContent = confidence
        ? `${Math.round(confidence * 100)}% confidence`
        : "";
      elements.resultProduct.textContent = [brand, title].filter(Boolean).join(" · ").slice(0, 60);
      elements.lastResult.hidden = false;
    }
  }
}

elements.openPanel.addEventListener("click", async () => {
  try {
    await ensureReady();
    await chrome.tabs.sendMessage(activeTabId, { type: "FITCHECK_TOGGLE_PANEL" });
    setStatus("Panel toggled on the active page.");
  } catch (_error) {
    setStatus("Fitcheck can only run after you open it on a normal product page.");
  }
});

elements.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

elements.setupBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function refreshProduct() {
  try {
    await ensureReady();
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: "FITCHECK_GET_PRODUCT"
    });

    if (!response?.ok) {
      throw new Error("Unable to read product details.");
    }

    elements.title.textContent = response.product.title || "Untitled item";
    elements.brand.textContent = response.product.brand || "Brand unknown";
    elements.pageState.textContent =
      response.product.category === "unknown" ? "Detected" : response.product.category;
    setStatus("");
  } catch (_error) {
    elements.pageState.textContent = "Unavailable";
    setStatus("Use Fitcheck from the toolbar while viewing a shopping page.");
  }
}

async function ensureReady() {
  if (!activeTabId || !isSupportedPage(activeTabUrl)) {
    throw new Error("No supported tab.");
  }

  const response = await chrome.runtime.sendMessage({
    type: "FITCHECK_ENSURE_CONTENT_SCRIPT",
    tabId: activeTabId
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Could not access this page.");
  }
}

function isSupportedPage(url) {
  return /^https?:\/\//i.test(url || "");
}

function setStatus(message) {
  elements.status.textContent = message;
}
