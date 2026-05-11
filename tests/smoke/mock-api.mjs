import http from "node:http";

const MOCK_ANALYSIS = {
  suggestedSize: "M",
  backupSize: "L",
  confidence: 0.82,
  riskScore: 18,
  explanation: "M should fit well based on your profile. Fabric is non-stretch cotton — consider sizing up if between sizes.",
  evidenceSnippets: [
    "Profile: usual tops size is M.",
    "True to size based on extracted signals.",
    "No structured size chart table detected."
  ],
  ruleSignals: [
    { id: "relaxed_fit", impact: -6, message: "Product signals a relaxed or oversized fit." },
    { id: "true_to_size", impact: -8, message: "Extracted evidence says this is true to size." }
  ],
  timestamp: new Date().toISOString(),
  webEvidence: {
    status: "disabled",
    reason: "Web evidence is turned off in Fitcheck settings.",
    provider: "none",
    queries: [],
    snippets: [],
    signals: [{ signal: "insufficientEvidence", type: "insufficient_evidence", text: "Web evidence is turned off." }],
    summary: ["Web evidence is turned off in Fitcheck settings."],
    cache: { hit: false, ttlMs: 1800000 }
  },
  ai: { mode: "rules_only", prompt: { system: "", user: "" } }
};

export function startMockApi(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "fitcheck-mock-api" }));
        return;
      }

      if (req.method === "POST" && req.url === "/analyze") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(MOCK_ANALYSIS));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    });

    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}
