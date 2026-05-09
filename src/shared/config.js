import { STORAGE_KEYS } from "./models.js";

export const DEFAULT_API_URL = "http://localhost:8787";

export const ANALYSIS_MODES = {
  rules_only: {
    id: "rules_only",
    label: "Rules only",
    description: "Local rules engine — no network calls, no API key needed.",
    requiresKey: false
  },
  rules_plus_web: {
    id: "rules_plus_web",
    label: "Rules + web evidence",
    description: "Rules engine enhanced with web search evidence. Requires a search provider key.",
    requiresKey: false
  },
  model_assisted: {
    id: "model_assisted",
    label: "Model-assisted (Gemini)",
    description: "Rules engine + optional web evidence + Gemini model review. Requires a Gemini API key.",
    requiresKey: true
  }
};

export const ANALYSIS_MODE_IDS = Object.keys(ANALYSIS_MODES);

export const DEFAULT_CONFIG = {
  apiUrl: DEFAULT_API_URL,
  analysisMode: "rules_only",
  webEvidenceEnabled: false,
  searchProvider: "firecrawl",
  geminiApiKey: ""
};

export const CONFIG_STORAGE_KEY = STORAGE_KEYS.config;
