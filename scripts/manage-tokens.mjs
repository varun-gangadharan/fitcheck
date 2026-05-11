/**
 * Fitcheck token manager — create, list, and revoke API tokens.
 *
 * Usage:
 *   node scripts/manage-tokens.mjs create "label"
 *   node scripts/manage-tokens.mjs list
 *   node scripts/manage-tokens.mjs revoke fck_...
 *
 * Tokens are stored in .fitcheck-cache/tokens.json.
 * Run this on the same machine (or volume) as the API server.
 */

// Resolve paths relative to the repo root, not the script directory.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, "..");

// Import auth-store from the backend (adjust FITCHECK_CACHE_DIR if needed)
const { createToken, listTokens, revokeToken } = await import(
  pathToFileURL(join(repoRoot, "src/backend/auth-store.js")).href
);

const [, , command, ...args] = process.argv;

if (command === "create") {
  const label = args.join(" ").trim();
  if (!label) {
    console.error('Usage: manage-tokens.mjs create "label"');
    process.exit(1);
  }
  const token = createToken(label);
  console.log(`\nToken created for: ${label}`);
  console.log(`\n  ${token}\n`);
  console.log("Share this token with the user. It cannot be recovered if lost.");
  console.log("They paste it into the Fitcheck options page → API Token field.\n");
}

else if (command === "list") {
  const tokens = listTokens();
  if (!tokens.length) {
    console.log("No tokens found. Create one with: manage-tokens.mjs create \"label\"");
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n${"Token".padEnd(56)}  ${"Label".padEnd(24)}  ${"Total".padStart(6)}  ${"Today".padStart(5)}  ${"AI/day".padStart(6)}  Status`);
  console.log("─".repeat(115));

  for (const t of tokens) {
    const usage = t.usage || {};
    const todayReqs = usage.todayDate === today ? (usage.today || 0) : 0;
    const todayAi = usage.aiCallsDate === today ? (usage.aiCallsToday || 0) : 0;
    const status = t.active ? "active" : "revoked";
    console.log(
      `${t.token.padEnd(56)}  ${(t.label || "").slice(0, 24).padEnd(24)}  ` +
      `${String(usage.total || 0).padStart(6)}  ${String(todayReqs).padStart(5)}  ` +
      `${String(todayAi).padStart(6)}  ${status}`
    );
  }
  console.log();
}

else if (command === "revoke") {
  const token = args[0];
  if (!token) {
    console.error("Usage: manage-tokens.mjs revoke fck_...");
    process.exit(1);
  }
  const ok = revokeToken(token);
  if (ok) {
    console.log(`Revoked: ${token}`);
  } else {
    console.error(`Token not found: ${token}`);
    process.exit(1);
  }
}

else {
  console.log(`
Fitcheck token manager

Commands:
  create "<label>"   Create a new API token (label = email or name)
  list               List all tokens with usage stats
  revoke <token>     Deactivate a token immediately

Examples:
  node scripts/manage-tokens.mjs create "alice@example.com"
  node scripts/manage-tokens.mjs list
  node scripts/manage-tokens.mjs revoke fck_a1b2c3...
`);
}
