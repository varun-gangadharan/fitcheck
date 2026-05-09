(function fitcheckContentScript() {
  const PANEL_ID = "fitcheck-panel-root";
  const STYLE_ID = "fitcheck-panel-style";
  const DETAIL_ID = "fitcheck-detail-region";

  const state = {
    product: emptyProduct(),
    analysis: null,
    profile: null,
    status: "idle",
    error: "",
    detailsOpen: false,
    noteDraft: "",
    extractorReady: null
  };

  state.extractorReady = import(chrome.runtime.getURL("src/shared/extract-product.js"))
    .then((module) => {
      state.extractor = module;
      state.product = extractProduct();
      if (module.looksLikeProductPage(document)) {
        document.documentElement.dataset.fitcheckProductPage = "true";
      }
      return module;
    })
    .catch((error) => {
      state.error = error.message;
      console.warn("[Fitcheck] Extractor failed to load", error);
    });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "FITCHECK_GET_PRODUCT") {
      state.extractorReady.then(() => {
        state.product = extractProduct();
        sendResponse({ ok: true, product: state.product });
      });
      return true;
    }

    if (message?.type === "FITCHECK_TOGGLE_PANEL") {
      state.extractorReady.then(() => {
        togglePanel();
        sendResponse({ ok: true, product: state.product });
      });
      return true;
    }

    return false;
  });

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      return;
    }

    injectStyles();
    renderPanel();
    loadProfile();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/content/panel.css");
    document.documentElement.append(link);
  }

  function renderPanel() {
    state.product = extractProduct();

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-label", "Fitcheck utility panel");
    panel.innerHTML = panelMarkup();
    document.body.append(panel);

    bindPanelEvents(panel);
  }

  function rerenderPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }

    panel.innerHTML = panelMarkup();
    bindPanelEvents(panel);
  }

  function bindPanelEvents(panel) {
    panel.querySelector("[data-fitcheck-close]")?.addEventListener("click", () => panel.remove());

    panel.querySelector("[data-fitcheck-analyze]")?.addEventListener("click", analyzeCurrentProduct);
    panel.querySelector("[data-fitcheck-expand]")?.addEventListener("click", () => {
      state.detailsOpen = !state.detailsOpen;
      rerenderPanel();
    });
    panel.querySelector("[data-fitcheck-save-note]")?.addEventListener("click", saveNote);

    panel.querySelector("[data-fitcheck-note]")?.addEventListener("input", (event) => {
      state.noteDraft = event.target.value;
    });

    panel.querySelectorAll("[data-fitcheck-outcome]").forEach((button) => {
      button.addEventListener("click", () => saveOutcome(button.getAttribute("data-fitcheck-outcome"), button));
    });
  }

  async function loadProfile() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "FITCHECK_GET_PROFILE" });
      if (response?.ok) {
        state.profile = response.profile;
        rerenderPanel();
      }
    } catch (_error) {
      // The profile indicator falls back gracefully if the background is unavailable.
    }
  }

  async function analyzeCurrentProduct() {
    state.product = extractProduct();
    state.analysis = null;
    state.error = "";

    if (!hasDetectedProduct(state.product)) {
      state.status = "no_product";
      rerenderPanel();
      return;
    }

    state.status = "loading";
    rerenderPanel();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "FITCHECK_ANALYZE_PRODUCT",
        product: state.product
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Analysis failed.");
      }

      state.analysis = response.analysis;
      state.status = response.analysis?.confidence < 0.35 ? "not_enough_evidence" : "complete";
    } catch (error) {
      state.status = "error";
      state.error = error.message;
    } finally {
      rerenderPanel();
    }
  }

  async function saveOutcome(outcome, button) {
    button.disabled = true;
    button.textContent = "Saved";

    const response = await chrome.runtime.sendMessage({
      type: "FITCHECK_SAVE_OUTCOME",
      record: {
        product: state.product,
        analysis: state.analysis,
        outcome
      }
    });

    if (!response?.ok) {
      state.error = response?.error || "Could not save outcome.";
      state.status = "error";
      rerenderPanel();
    }
  }

  async function saveNote() {
    const note = state.noteDraft.trim();
    if (!note) {
      state.error = "Add a note before saving.";
      state.status = "error";
      rerenderPanel();
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "FITCHECK_SAVE_OUTCOME",
      record: {
        product: state.product,
        analysis: state.analysis,
        outcome: null,
        note
      }
    });

    if (!response?.ok) {
      state.error = response?.error || "Could not save note.";
      state.status = "error";
      rerenderPanel();
      return;
    }

    state.noteDraft = "";
    state.error = "";
    if (state.status === "error") {
      state.status = state.analysis ? "complete" : "idle";
    }
    rerenderPanel();
  }

  function panelMarkup() {
    const product = state.product;
    const analysis = state.analysis;
    const panelState = getPanelState(product);

    return `
      <header class="fitcheck-panel__header">
        <div>
          <p class="fitcheck-panel__eyebrow">${escapeHtml(product.brand || "Product")}</p>
          <h2>${escapeHtml(product.title || "No product detected")}</h2>
        </div>
        <button type="button" class="fitcheck-icon-button" aria-label="Close Fitcheck" data-fitcheck-close>×</button>
      </header>

      <section class="fitcheck-panel__meta">
        <span>${escapeHtml(product.category)}</span>
        <span>${escapeHtml(profileModeLabel())}</span>
      </section>

      ${stateMarkup(panelState)}

      <section class="fitcheck-panel__score" aria-live="polite">
        <div>
          <span>Fit risk</span>
          <strong>${analysis ? `${analysis.riskScore}/100` : "--"}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>${analysis ? `${Math.round(analysis.confidence * 100)}%` : "--"}</strong>
        </div>
      </section>

      <section class="fitcheck-panel__recommendation">
        <p>Suggested size</p>
        <strong>${analysis ? escapeHtml(analysis.suggestedSize) : "Analyze first"}</strong>
        <span>Backup: ${analysis ? escapeHtml(analysis.backupSize) : "--"}</span>
      </section>

      ${analysis ? analysisMarkup(analysis) : productSummaryMarkup(product)}

      <section class="fitcheck-panel__note">
        <label for="fitcheck-note">Note</label>
        <textarea id="fitcheck-note" data-fitcheck-note rows="2" placeholder="Save a brand or fit note">${escapeHtml(state.noteDraft)}</textarea>
      </section>

      <footer class="fitcheck-panel__footer">
        <button type="button" class="fitcheck-primary-button" data-fitcheck-analyze ${state.status === "loading" ? "disabled" : ""}>
          ${state.status === "loading" ? "Analyzing..." : "Analyze"}
        </button>
        <button type="button" data-fitcheck-save-note>Save note</button>
        <button type="button" data-fitcheck-expand aria-expanded="${state.detailsOpen}" aria-controls="${DETAIL_ID}">
          ${state.detailsOpen ? "Hide details" : "Expand details"}
        </button>
      </footer>
    `;
  }

  function getPanelState(product) {
    if (state.status === "loading" || state.status === "error" || state.status === "not_enough_evidence") {
      return state.status;
    }
    if (!hasDetectedProduct(product)) {
      return "no_product";
    }
    if (state.analysis) {
      return "complete";
    }
    return "ready";
  }

  function stateMarkup(panelState) {
    const messages = {
      no_product: ["No product detected", "Fitcheck could not find a product title or size options on this page."],
      ready: ["Ready to analyze", "Visible product details were extracted from this page."],
      loading: ["Analyzing", "Sending extracted product data to the local Fitcheck API."],
      not_enough_evidence: ["Not enough evidence", "The result has low confidence because key product or web evidence is missing."],
      complete: ["Analysis complete", "Recommendation is ready."],
      error: ["Error", state.error || "Something went wrong."]
    };
    const [title, body] = messages[panelState];
    return `<section class="fitcheck-panel__state fitcheck-panel__state--${panelState}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </section>`;
  }

  function productSummaryMarkup(product) {
    return `
      <section class="fitcheck-panel__details">
        <dl>
          <div><dt>Sizes</dt><dd>${escapeHtml(product.sizeOptions.join(", ") || "Missing")}</dd></div>
          <div><dt>Signals</dt><dd>${escapeHtml(product.fitSignals.map((signal) => signal.label).join(", ") || "None visible")}</dd></div>
        </dl>
        ${detailsMarkup(product)}
      </section>
    `;
  }

  function analysisMarkup(analysis) {
    return `
      <section class="fitcheck-panel__details">
        <p>${escapeHtml(analysis.explanation)}</p>
        <ul>
          ${analysis.evidenceSnippets.map((snippet) => `<li>${escapeHtml(snippet)}</li>`).join("")}
        </ul>
        <section class="fitcheck-panel__outcomes" aria-label="Mark fit outcome">
          <button type="button" data-fitcheck-outcome="fit">Fit</button>
          <button type="button" data-fitcheck-outcome="too_small">Too small</button>
          <button type="button" data-fitcheck-outcome="too_big">Too big</button>
          <button type="button" data-fitcheck-outcome="returned">Returned</button>
        </section>
        ${detailsMarkup(state.product)}
      </section>
    `;
  }

  function detailsMarkup(product) {
    if (!state.detailsOpen) {
      return "";
    }

    const table = product.sizeChart.tables[0];
    return `
      <section class="fitcheck-panel__expanded" id="${DETAIL_ID}">
        <dl>
          <div><dt>Fabric</dt><dd>${escapeHtml(product.fabricComposition || "Missing")}</dd></div>
          <div><dt>Returns</dt><dd>${escapeHtml(product.returnPolicy || "Missing")}</dd></div>
          <div><dt>Missing</dt><dd>${escapeHtml(product.extractedSignals.missingFields.join(", ") || "None")}</dd></div>
        </dl>
        ${sourceMarkup(state.analysis)}
        ${table ? tableMarkup(table) : `<p>No structured size chart table detected.</p>`}
      </section>
    `;
  }

  function sourceMarkup(analysis) {
    const sources = analysis?.webEvidence?.snippets || [];
    if (!sources.length) {
      return `<p>${escapeHtml(analysis?.webEvidence?.reason || "No web evidence sources available.")}</p>`;
    }

    return `
      <div class="fitcheck-panel__sources">
        <strong>Sources</strong>
        <ul>
          ${sources.slice(0, 4).map((source) => `
            <li><a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.source || "source")}</a></li>
          `).join("")}
        </ul>
      </div>
    `;
  }

  function tableMarkup(table) {
    return `
      <div class="fitcheck-panel__table-wrap">
        <table>
          <thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
          <tbody>
            ${table.rows.slice(0, 4).map((row) => `
              <tr>${table.columns.map((column) => `<td>${escapeHtml(row[column] || "")}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function profileModeLabel() {
    return state.profile?.mode === "exact" ? "Exact profile" : "Lightweight profile";
  }

  function extractProduct() {
    if (!state.extractor) {
      return state.product || emptyProduct();
    }

    return state.extractor.extractProductFromDocument(document, {
      url: location.href
    });
  }

  function hasDetectedProduct(product) {
    return Boolean(product.title && (product.sizeOptions.length || product.extractedSignals.hasAddToCart || product.sizeChart.tables.length));
  }

  function emptyProduct() {
    return {
      url: location.href,
      brand: "",
      title: "",
      category: "unknown",
      sizeOptions: [],
      sizeChart: { sourceText: "", tables: [] },
      fabricComposition: "",
      returnPolicy: "",
      fitSignals: [],
      extractedSignals: {
        hasSizeSelector: false,
        hasAddToCart: false,
        missingFields: ["title", "brand", "sizeOptions", "sizeChart", "fabricComposition", "returnPolicy"],
        detectedAt: null
      }
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };
      return entities[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }
})();
