import {
  clearHistory,
  getBrandNotes,
  getConfig,
  getUserProfile,
  saveBrandNotes,
  saveConfig,
  saveUserProfile,
  upsertBrandNote
} from "../shared/storage.js";

const form = document.getElementById("profile-form");
const status = document.getElementById("status");
const clearHistoryButton = document.getElementById("clear-history");
const saveBrandNoteButton = document.getElementById("save-brand-note");
const brandNotesContainer = document.getElementById("brand-notes");
const geminiKeyRow = document.getElementById("gemini-key-row");
const modeStatus = document.getElementById("mode-status");

init();

async function init() {
  const [profile, config, brandNotes] = await Promise.all([getUserProfile(), getConfig(), getBrandNotes()]);
  fillForm(profile);
  form.elements.apiUrl.value = config.apiUrl;
  form.elements.apiToken.value = config.apiToken || "";
  form.elements.searchProvider.value = config.searchProvider || "firecrawl";
  form.elements.analysisMode.value = config.analysisMode || "rules_only";
  updateModeUI();
  renderBrandNotes(brandNotes);
}

for (const radio of form.elements.analysisMode) {
  radio.addEventListener("change", updateModeUI);
}

function updateModeUI() {
  const mode = form.elements.analysisMode.value;
  geminiKeyRow.hidden = mode !== "model_assisted";

  const labels = {
    rules_only: "Active: rules engine only, no external calls.",
    rules_plus_web: "Active: rules engine + web search evidence.",
    model_assisted: "Active: rules + Gemini model review."
  };
  modeStatus.textContent = labels[mode] || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const profile = {
    mode: data.get("mode"),
    usualSizes: {
      tops: clean(data.get("usualTops")),
      bottoms: clean(data.get("usualBottoms")),
      shoes: clean(data.get("usualShoes")),
      accessories: ""
    },
    fitPreference: {
      tops: data.get("fitTops"),
      bottoms: data.get("fitBottoms"),
      shoes: data.get("fitShoes"),
      accessories: "regular"
    },
    bodyNotes: clean(data.get("bodyNotes")),
    measurements: {
      chestBust: clean(data.get("chestBust")),
      waist: clean(data.get("waist")),
      hips: clean(data.get("hips")),
      inseam: clean(data.get("inseam")),
      shoulderWidth: clean(data.get("shoulderWidth")),
      height: clean(data.get("height")),
      footLength: clean(data.get("footLength"))
    }
  };

  try {
    const mode = clean(data.get("analysisMode")) || "rules_only";
    await saveUserProfile(profile);
    await saveConfig({
      apiUrl: clean(data.get("apiUrl")),
      apiToken: clean(data.get("apiToken")),
      analysisMode: mode,
      webEvidenceEnabled: mode === "rules_plus_web" || mode === "model_assisted",
      searchProvider: clean(data.get("searchProvider")) || "firecrawl",
      // geminiApiKey excluded — configured via GEMINI_API_KEY env var on the server
    });
    setStatus("Profile saved.");
  } catch (_error) {
    setStatus("Could not save profile locally.");
    return;
  }

  // Add a welcome message if this is the first save (the popup uses this to
  // hide the setup banner).
  const existing = await chrome.storage.local.get("fitcheck:onboarded");
  if (!existing["fitcheck:onboarded"]) {
    await chrome.storage.local.set({ "fitcheck:onboarded": true });
    setStatus("Profile saved. You're all set — open Fitcheck on any product page.");
  }
});

clearHistoryButton.addEventListener("click", async () => {
  try {
    await clearHistory();
    setStatus("History cleared.");
  } catch (_error) {
    setStatus("Could not clear local history.");
  }
});

saveBrandNoteButton.addEventListener("click", async () => {
  const data = new FormData(form);
  const brand = clean(data.get("brandNoteBrand"));
  if (!brand) {
    setStatus("Add a brand before saving a note.");
    return;
  }

  try {
    await upsertBrandNote({
      brand,
      category: clean(data.get("brandNoteCategory")) || "unknown",
      typicalRecommendation: clean(data.get("brandNoteRecommendation")),
      notes: clean(data.get("brandNoteNotes"))
    });
    form.elements.brandNoteBrand.value = "";
    form.elements.brandNoteRecommendation.value = "";
    form.elements.brandNoteNotes.value = "";
    renderBrandNotes(await getBrandNotes());
    setStatus("Brand note saved.");
  } catch (_error) {
    setStatus("Could not save brand note locally.");
  }
});

brandNotesContainer.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-brand-note]");
  if (!button) return;

  const index = Number.parseInt(button.getAttribute("data-delete-brand-note"), 10);
  const brandNotes = await getBrandNotes();
  brandNotes.splice(index, 1);
  await saveBrandNotes(brandNotes);
  renderBrandNotes(brandNotes);
  setStatus("Brand note removed.");
});

function fillForm(profile) {
  form.elements.mode.value = profile.mode;
  form.elements.usualTops.value = profile.usualSizes?.tops || "";
  form.elements.usualBottoms.value = profile.usualSizes?.bottoms || "";
  form.elements.usualShoes.value = profile.usualSizes?.shoes || "";
  form.elements.fitTops.value = profile.fitPreference?.tops || "regular";
  form.elements.fitBottoms.value = profile.fitPreference?.bottoms || "regular";
  form.elements.fitShoes.value = profile.fitPreference?.shoes || "regular";
  form.elements.bodyNotes.value = profile.bodyNotes || "";
  form.elements.chestBust.value = profile.measurements?.chestBust || "";
  form.elements.waist.value = profile.measurements?.waist || "";
  form.elements.hips.value = profile.measurements?.hips || "";
  form.elements.inseam.value = profile.measurements?.inseam || "";
  form.elements.shoulderWidth.value = profile.measurements?.shoulderWidth || "";
  form.elements.height.value = profile.measurements?.height || "";
  form.elements.footLength.value = profile.measurements?.footLength || "";
}

function renderBrandNotes(brandNotes) {
  if (!brandNotes.length) {
    brandNotesContainer.innerHTML = `<p class="empty">No brand notes yet.</p>`;
    return;
  }

  brandNotesContainer.innerHTML = brandNotes.map((note, index) => `
    <article>
      <div>
        <strong>${escapeHtml(note.brand)}</strong>
        <span>${escapeHtml(note.category || "unknown")} · ${escapeHtml(note.typicalRecommendation || "no recommendation")}</span>
        <p>${escapeHtml(note.notes || "No notes")}</p>
      </div>
      <button type="button" data-delete-brand-note="${index}">Remove</button>
    </article>
  `).join("");
}

function clean(value) {
  return String(value ?? "").trim();
}

function setStatus(message) {
  status.textContent = message;
  window.setTimeout(() => {
    if (status.textContent === message) {
      status.textContent = "";
    }
  }, 2400);
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
