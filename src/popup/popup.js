const elements = {
  pageState: document.getElementById("page-state"),
  title: document.getElementById("product-title"),
  brand: document.getElementById("product-brand"),
  status: document.getElementById("status"),
  openPanel: document.getElementById("open-panel"),
  openOptions: document.getElementById("open-options")
};

let activeTabId = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  if (!activeTabId || !tab.url?.startsWith("http")) {
    setStatus("Open a product page to use Fitcheck.");
    elements.pageState.textContent = "No page";
    elements.openPanel.disabled = true;
    return;
  }

  await refreshProduct();
}

elements.openPanel.addEventListener("click", async () => {
  try {
    await chrome.tabs.sendMessage(activeTabId, { type: "FITCHECK_TOGGLE_PANEL" });
    setStatus("Panel toggled on the active page.");
  } catch (_error) {
    setStatus("Reload the page, then try opening the panel again.");
  }
});

elements.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function refreshProduct() {
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: "FITCHECK_GET_PRODUCT"
    });

    if (!response?.ok) {
      throw new Error("Unable to read product details.");
    }

    elements.title.textContent = response.product.title || "Untitled item";
    elements.brand.textContent = response.product.brand || "Brand unknown";
    elements.pageState.textContent = response.product.category === "unknown" ? "Detected" : response.product.category;
    setStatus("");
  } catch (_error) {
    elements.pageState.textContent = "Reload";
    setStatus("Reload this tab so the Fitcheck content script can start.");
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}
