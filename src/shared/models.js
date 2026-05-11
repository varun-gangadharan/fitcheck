/**
 * @typedef {"tops" | "bottoms" | "shoes" | "accessories" | "unknown"} ProductCategory
 * @typedef {"lightweight" | "exact"} ProfileMode
 * @typedef {"snug" | "regular" | "relaxed"} FitPreference
 * @typedef {"fit" | "too_small" | "too_big" | "returned"} FitOutcome
 * @typedef {"runs_small" | "runs_large" | "true_to_size" | "oversized" | "slim_fit" | "relaxed_fit" | "stretch" | "non_stretch" | "runs_narrow" | "runs_wide" | "half_size_up"} FitSignalType
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
 * @property {string} price
 * @property {string[]} sizeOptions
 * @property {{ sourceText: string, tables: SizeChartTable[] }} sizeChart
 * @property {string} fabricComposition
 * @property {string} returnPolicy
 * @property {{ type: FitSignalType, label: string, text: string }[]} fitSignals
 * @property {Object} extractedSignals
 */

export const STORAGE_KEYS = {
  schemaVersion: "fitcheck:schemaVersion",
  config: "fitcheck:config",
  userProfile: "fitcheck:userProfile",
  brandNotes: "fitcheck:brandNotes",
  history: "fitcheck:history",
  analysisResults: "fitcheck:analysisResults"
};

export const CURRENT_SCHEMA_VERSION = 3;

export const DEFAULT_PROFILE = {
  mode: "lightweight",
  usualSizes: {
    tops: "M",
    bottoms: "32",
    shoes: "",
    accessories: ""
  },
  fitPreference: {
    tops: "regular",
    bottoms: "regular",
    shoes: "regular",
    accessories: "regular"
  },
  bodyNotes: "",
  measurements: {
    chestBust: "",
    waist: "",
    hips: "",
    inseam: "",
    shoulderWidth: "",
    height: "",
    footLength: ""
  },
  updatedAt: null
};

export const EMPTY_BRAND_NOTE = {
  brand: "",
  category: "unknown",
  typicalRecommendation: "",
  lastOutcome: "",
  outcomeCounts: {
    fit: 0,
    too_small: 0,
    too_big: 0,
    returned: 0
  },
  /** Numeric bias in [-2, 2] derived from outcomes. Positive = size up. */
  bias: 0,
  notes: "",
  updatedAt: null
};

export const PRODUCT_CATEGORIES = ["tops", "bottoms", "shoes", "accessories", "unknown"];
export const FIT_PREFERENCES = ["snug", "regular", "relaxed"];
export const FIT_OUTCOMES = ["fit", "too_small", "too_big", "returned"];

export const EMPTY_PRODUCT_RECORD = {
  url: "",
  brand: "",
  title: "",
  category: "unknown",
  price: "",
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
