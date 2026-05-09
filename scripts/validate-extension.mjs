import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "manifest.json",
  "src/background/service-worker.js",
  "src/content/content-script.js",
  "src/content/panel.css",
  "src/popup/popup.html",
  "src/popup/popup.js",
  "src/options/options.html",
  "src/options/options.js",
  "src/shared/models.js",
  "src/shared/storage.js",
  "src/shared/mock-analysis.js",
  "src/shared/extract-product.js",
  "src/shared/config.js",
  "src/backend/server.js",
  "src/backend/validation.js",
  "src/backend/recommendation-engine.js",
  "src/backend/prompt-builder.js",
  "tests/fixtures/top-product.html",
  "tests/fixtures/bottom-product.html",
  "tests/fixtures/minimal-product.html",
  "tests/extract-product.test.mjs",
  "tests/recommendation-engine.test.mjs",
  "tests/api-validation.test.mjs",
  "tests/evidence-service.test.mjs",
  "src/backend/evidence-service.js"
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url));
}

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);

if (manifest.manifest_version !== 3) {
  throw new Error("manifest.json must use Manifest V3.");
}

console.log(`Validated ${requiredFiles.length} extension files.`);
