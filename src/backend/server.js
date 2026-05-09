import http from "node:http";
import { gatherEvidence } from "./evidence-service.js";
import { analyzeFit } from "./recommendation-engine.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";
import { validateAnalyzeRequest } from "./validation.js";

const PORT = Number.parseInt(process.env.FITCHECK_API_PORT || "8787", 10);
const HOST = process.env.FITCHECK_API_HOST || "127.0.0.1";

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

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

  try {
    const payload = await readJson(request);
    const errors = validateAnalyzeRequest(payload);

    if (errors.length) {
      sendJson(response, 400, {
        error: "invalid_request",
        message: "Analyze request is invalid.",
        details: errors
      });
      return;
    }

    const webEvidence = payload.webEvidence || await gatherEvidence(payload.product);
    const evidenceSignals = payload.evidenceSignals || [
      ...mockEvidenceSignals(payload.product),
      ...(webEvidence.signals || [])
    ];
    const analysis = analyzeFit({
      product: payload.product,
      profile: payload.profile,
      brandMemory: payload.brandMemory || [],
      history: payload.history || [],
      evidenceSignals,
      webEvidence
    });
    const prompt = buildAnalysisPrompt({
      product: payload.product,
      profile: payload.profile,
      brandMemory: payload.brandMemory || [],
      history: payload.history || [],
      evidenceSignals
    });

    sendJson(response, 200, {
      ...analysis,
      webEvidence,
      ai: {
        mode: process.env.OPENAI_API_KEY ? "configured_not_called" : "rules_only",
        prompt
      }
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.code || "server_error",
      message: error.message || "Unexpected server error."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Fitcheck API listening on http://${HOST}:${PORT}`);
});

function mockEvidenceSignals(product) {
  return (product.fitSignals || []).map((signal) => ({
    type: signal.type,
    source: "product_page",
    text: signal.text
  }));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch (_error) {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}
