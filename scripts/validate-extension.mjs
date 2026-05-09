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
  "tests/fixtures/top-product.html",
  "tests/fixtures/bottom-product.html",
  "tests/fixtures/minimal-product.html",
  "tests/extract-product.test.mjs"
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
