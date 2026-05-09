/**
 * @typedef {"tops" | "bottoms" | "unknown"} ProductCategory
 * @typedef {"lightweight" | "exact"} ProfileMode
 * @typedef {"snug" | "regular" | "relaxed"} FitPreference
 * @typedef {"fit" | "too_small" | "too_big" | "returned"} FitOutcome
 * @typedef {"runs_small" | "runs_large" | "true_to_size" | "oversized" | "slim_fit" | "relaxed_fit" | "stretch" | "non_stretch"} FitSignalType
 *
 * @typedef {Object} SizeChartTable
 * @property {string} caption
 * @property {string[]} columns
 * @property {Array<Record<string, string>>} rows
 *
 * @typedef {Object} ProductRecord
 * @property {string} url
 * @property {string} brand
 * @property {string} title
 * @property {ProductCategory} category
 * @property {string[]} sizeOptions
 * @property {{ sourceText: string, tables: SizeChartTable[] }} sizeChart
 * @property {string} fabricComposition
 * @property {string} returnPolicy
 * @property {{ type: FitSignalType, label: string, text: string }[]} fitSignals
 * @property {Object} extractedSignals
 */

export const STORAGE_KEYS = {
  userProfile: "fitcheck:userProfile",
  brandNotes: "fitcheck:brandNotes",
  history: "fitcheck:history"
};

export const DEFAULT_PROFILE = {
  mode: "lightweight",
  usualSizes: {
    tops: "M",
    bottoms: "32"
  },
  fitPreference: {
    tops: "regular",
    bottoms: "regular"
  },
  bodyNotes: "",
  measurements: {
    chestBust: "",
    waist: "",
    hips: "",
    inseam: "",
    shoulderWidth: "",
    height: ""
  },
  updatedAt: null
};

export const EMPTY_BRAND_NOTE = {
  brand: "",
  category: "unknown",
  typicalRecommendation: "",
  lastOutcome: "",
  notes: "",
  updatedAt: null
};

export const PRODUCT_CATEGORIES = ["tops", "bottoms", "unknown"];
export const FIT_PREFERENCES = ["snug", "regular", "relaxed"];
export const FIT_OUTCOMES = ["fit", "too_small", "too_big", "returned"];

export const EMPTY_PRODUCT_RECORD = {
  url: "",
  brand: "",
  title: "",
  category: "unknown",
  sizeOptions: [],
  sizeChart: {
    sourceText: "",
    tables: []
  },
  fabricComposition: "",
  returnPolicy: "",
  fitSignals: [],
  extractedSignals: {
    hasSizeSelector: false,
    hasAddToCart: false,
    missingFields: [],
    detectedAt: null
  }
};
