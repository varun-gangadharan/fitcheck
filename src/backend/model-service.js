const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export async function callModel(prompt, options = {}) {
  const apiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || "";

  if (!apiKey) {
    return {
      status: "no_api_key",
      reason: "Gemini API key is not configured. Falling back to rules-only analysis.",
      output: null
    };
  }

  const url = `${GEMINI_GENERATE_URL}?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: `${prompt.system}\n\n${prompt.user}` }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: "application/json"
    }
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    return {
      status: "network_error",
      reason: `Gemini request failed: ${error.message}`,
      output: null
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      status: "api_error",
      reason: `Gemini returned ${response.status}: ${text.slice(0, 200)}`,
      output: null
    };
  }

  const result = await response.json();
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return {
      status: "ok",
      reason: "",
      output: JSON.parse(cleaned)
    };
  } catch (_error) {
    return {
      status: "parse_error",
      reason: "Gemini returned non-JSON output.",
      output: null,
      rawText: raw.slice(0, 500)
    };
  }
}
