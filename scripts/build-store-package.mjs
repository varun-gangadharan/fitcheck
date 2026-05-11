import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "dist", "chrome-store");

const copyTargets = [
  "manifest.json",
  "icons",
  "src/background",
  "src/content",
  "src/options",
  "src/popup",
  "src/privacy",
  "src/shared",
  "src/backend/recommendation-engine.js"
];

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

for (const relativePath of copyTargets) {
  const from = path.join(ROOT, relativePath);
  const to = path.join(OUT_DIR, relativePath);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

console.log(`Chrome Store package staged at ${OUT_DIR}`);
