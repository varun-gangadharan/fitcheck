import http from "node:http";
import { loadEnvFile } from "./env.js";
import { initEvidenceStore } from "./evidence-service.js";
import { runAnalysis } from "./analysis-orchestrator.js";
import { validateAnalyzeRequest } from "./validation.js";
import { checkAuth } from "./auth-middleware.js";
import { recordUsage } from "./auth-store.js";
import {
  isAllowedRequestOrigin,
  isLocalRequestAddress,
  MAX_ANALYZE_REQUEST_BYTES
} from "../shared/security.js";

loadEnvFile();
initEvidenceStore();

const PORT = Number.parseInt(process.env.FITCHECK_API_PORT || "8787", 10);
const HOST = process.env.FITCHECK_API_HOST || "127.0.0.1";

// Set FITCHECK_ALLOWED_ORIGIN to a comma-separated list to explicitly lock CORS.
// Without it, only Chrome extension origins and localhost browser origins are allowed.
const ALLOWED_ORIGINS = String(process.env.FITCHECK_ALLOWED_ORIGIN || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const server = http.createServer(async (request, response) => {
  if (!isLocalRequestAddress(request.socket.remoteAddress)) {
    sendJson(response, 403, {
      error: "forbidden",
      message: "Fitcheck API only accepts localhost connections."
    });
    return;
  }

  const requestOrigin = request.headers["origin"] || "";
  if (!isAllowedRequestOrigin(requestOrigin, ALLOWED_ORIGINS)) {
    sendJson(response, 403, {
      error: "forbidden_origin",
      message: "This origin is not allowed to access the Fitcheck API."
    });
    return;
  }
  setCorsHeaders(response, requestOrigin);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true, service: "fitcheck-api" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/analyze") {
    sendJson(response, 404, { error: "not_found", message: "Use POST /analyze." });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    sendJson(response, 400, { error: "invalid_json", message: error.message });
    return;
  }

  const errors = validateAnalyzeRequest(payload);
  if (errors.length) {
    sendJson(response, 400, {
      error: "invalid_request",
      message: "Analyze request is invalid.",
      details: errors
    });
    return;
  }

  const isAiCall = payload.options?.analysisMode === "model_assisted";

  // Authenticate and enforce rate limits before doing any expensive work.
  const record = checkAuth(request, response, { isAiCall });
  if (!record) return; // checkAuth already sent the error response

  try {
    const result = await runAnalysis(payload);
    // Record usage only after successful analysis so failed/errored calls
    // don't count against the user's daily quota.
    recordUsage(record.token, { isAiCall });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.code || "server_error",
      message: error.message || "Unexpected server error."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fitcheck API listening on http://${HOST}:${PORT}`);
  if (!ALLOWED_ORIGINS.length) {
    console.log("  CORS: allowing Chrome extension origins and localhost origins.");
  } else {
    console.log(`  CORS: locked to ${ALLOWED_ORIGINS.join(", ")}`);
  }
});

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_ANALYZE_REQUEST_BYTES) {
      const error = new Error(`Request body exceeds ${MAX_ANALYZE_REQUEST_BYTES} bytes.`);
      error.statusCode = 413;
      error.code = "payload_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function setCorsHeaders(response, requestOrigin) {
  const allow = isAllowedRequestOrigin(requestOrigin, ALLOWED_ORIGINS) ? requestOrigin : null;

  if (allow) {
    response.setHeader("Access-Control-Allow-Origin", allow);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
