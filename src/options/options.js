import { clearHistory, getUserProfile, saveUserProfile } from "../shared/storage.js";

const form = document.getElementById("profile-form");
const status = document.getElementById("status");
const clearHistoryButton = document.getElementById("clear-history");

init();

async function init() {
  const profile = await getUserProfile();
  fillForm(profile);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const profile = {
    mode: data.get("mode"),
    usualSizes: {
      tops: clean(data.get("usualTops")),
      bottoms: clean(data.get("usualBottoms"))
    },
    fitPreference: {
      tops: data.get("fitTops"),
      bottoms: data.get("fitBottoms")
    },
    bodyNotes: clean(data.get("bodyNotes")),
    measurements: {
      chestBust: clean(data.get("chestBust")),
      waist: clean(data.get("waist")),
      hips: clean(data.get("hips")),
      inseam: clean(data.get("inseam")),
      shoulderWidth: clean(data.get("shoulderWidth")),
      height: clean(data.get("height"))
    }
  };

  await saveUserProfile(profile);
  setStatus("Profile saved.");
});

clearHistoryButton.addEventListener("click", async () => {
  await clearHistory();
  setStatus("History cleared.");
});

function fillForm(profile) {
  form.elements.mode.value = profile.mode;
  form.elements.usualTops.value = profile.usualSizes?.tops || "";
  form.elements.usualBottoms.value = profile.usualSizes?.bottoms || "";
  form.elements.fitTops.value = profile.fitPreference?.tops || "regular";
  form.elements.fitBottoms.value = profile.fitPreference?.bottoms || "regular";
  form.elements.bodyNotes.value = profile.bodyNotes || "";
  form.elements.chestBust.value = profile.measurements?.chestBust || "";
  form.elements.waist.value = profile.measurements?.waist || "";
  form.elements.hips.value = profile.measurements?.hips || "";
  form.elements.inseam.value = profile.measurements?.inseam || "";
  form.elements.shoulderWidth.value = profile.measurements?.shoulderWidth || "";
  form.elements.height.value = profile.measurements?.height || "";
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
