import { describe, expect, it, vi } from "vitest";
import { GeminiSemanticAnalyzer, createSemanticAnalyzerFromEnv } from "../src/semantic/index.js";
import type { SemanticInput } from "../src/semantic/types.js";

const input: SemanticInput = {
  repository: "acme/api",
  pullRequest: 12,
  filePath: "src/routes/orders.ts",
  reviewComment: "Order mutations require authentication.",
  rejectedCode: "router.post('/orders', createOrder)",
  acceptedCode: "router.post('/orders', requireAuth, createOrder)",
};

const analysis = {
  intent: "security",
  title: "Authenticate order mutations",
  rule: "Order mutation routes require authentication middleware.",
  rationale: "The accepted route adds the authentication guard.",
  detection: {
    mode: "missing-required-signal",
    semanticDescription: "An order mutation route is missing authentication.",
    triggerSignals: ["router.post"],
    forbiddenSignals: [],
    requiredSignals: ["requireAuth"],
    matchScope: "line",
  },
};

function response(value = analysis, status = 200): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }], role: "model" } }],
  }), { status, headers: { "content-type": "application/json" } });
}

describe("GeminiSemanticAnalyzer", () => {
  it("requests schema-constrained JSON and returns grounded semantic analysis", async () => {
    const fetchMock = vi.fn(async () => response());
    const analyzer = new GeminiSemanticAnalyzer({
      apiKey: "gemini-secret",
      model: "gemini-2.5-flash",
      baseUrl: "https://gemini.example/v1beta/",
      fetch: fetchMock as typeof fetch,
      maxRetries: 0,
    });

    await expect(analyzer.analyze(input)).resolves.toMatchObject({
      intent: "security",
      preferredSignals: ["requireAuth"],
      detection: { mode: "missing-required-signal" },
    });
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gemini.example/v1beta/models/gemini-2.5-flash:generateContent");
    expect(request.headers).toMatchObject({ "x-goog-api-key": "gemini-secret" });
    const body = JSON.parse(String(request.body));
    expect(body.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        required: ["intent", "title", "rule", "rationale", "detection"],
        properties: { detection: { properties: { mode: { enum: expect.any(Array) } } } },
      },
    });
  });

  it("retries transient failures and falls back deterministically through the factory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(analysis, 429))
      .mockResolvedValueOnce(response());
    const analyzer = createSemanticAnalyzerFromEnv({
      ENGINEERING_MEMORY_SEMANTIC_ANALYZER: "gemini",
      ENGINEERING_MEMORY_SEMANTIC_FALLBACK: "deterministic",
      GEMINI_API_KEY: "secret",
      GEMINI_MODEL: "gemini-2.5-flash",
      GEMINI_MAX_RETRIES: "1",
      GEMINI_RETRY_DELAY_MS: "0",
    }, { fetch: fetchMock as typeof fetch });

    expect(analyzer).toMatchObject({
      provider: "gemini-with-deterministic-fallback",
      version: "gemini-2.5-flash|3",
    });
    await expect(analyzer.analyze(input)).resolves.toMatchObject({ intent: "security" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires an API key when Gemini is selected", () => {
    expect(() => createSemanticAnalyzerFromEnv({
      ENGINEERING_MEMORY_SEMANTIC_ANALYZER: "gemini",
    })).toThrow("GEMINI_API_KEY");
  });
});
