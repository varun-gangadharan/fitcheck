import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnvFile(path = ".env") {
  const envPath = resolve(process.cwd(), path);
  let contents = "";

  try {
    contents = readFileSync(envPath, "utf8");
  } catch (_error) {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
