export function validateAnalyzeRequest(payload) {
  const errors = [];
  const allowedCategories = ["tops", "bottoms", "shoes", "accessories", "unknown"];

  if (!payload || typeof payload !== "object") {
    return ["Request body must be a JSON object."];
  }

  if (!payload.product || typeof payload.product !== "object") {
    errors.push("product is required.");
  } else {
    if (!stringValue(payload.product.title)) errors.push("product.title is required.");
    if (!stringValue(payload.product.url)) errors.push("product.url is required.");
    if (!allowedCategories.includes(payload.product.category)) {
      errors.push(`product.category must be ${allowedCategories.slice(0, -1).join(", ")}, or unknown.`);
    }
    if (!Array.isArray(payload.product.sizeOptions)) {
      errors.push("product.sizeOptions must be an array.");
    }
  }

  if (!payload.profile || typeof payload.profile !== "object") {
    errors.push("profile is required.");
  } else {
    if (!["lightweight", "exact"].includes(payload.profile.mode)) {
      errors.push("profile.mode must be lightweight or exact.");
    }
    if (!payload.profile.usualSizes || typeof payload.profile.usualSizes !== "object") {
      errors.push("profile.usualSizes is required.");
    }
  }

  if (payload.brandMemory && !Array.isArray(payload.brandMemory)) {
    errors.push("brandMemory must be an array when provided.");
  }

  if (payload.history && !Array.isArray(payload.history)) {
    errors.push("history must be an array when provided.");
  }

  return errors;
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
