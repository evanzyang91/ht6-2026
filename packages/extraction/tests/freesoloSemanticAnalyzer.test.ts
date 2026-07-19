import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  FallbackSemanticAnalyzer,
  ENGINEERING_MEMORY_SYSTEM_PROMPT,
  FreesoloSemanticAnalyzer,
  SemanticAnalysisValidationError,
  createSemanticAnalyzerFromEnv,
  parseSemanticAnalysis,
} from "../src/semantic/index.js";
import type { SemanticAnalyzer, SemanticInput } from "../src/semantic/types.js";

const input: SemanticInput = {
  repository: "acme/api",
  pullRequest: 310,
  filePath: "src/routes/reports.ts",
  reviewComment: "New public endpoints must be guarded by a feature flag.",
  rejectedCode: "router.get('/reports', requireAuth, reportsController)",
  acceptedCode: "router.get('/reports', requireAuth, requireFeature('reports'), reportsController)",
};

const validAnalysis = {
  intent: "architecture",
  title: "Feature-flag public endpoints",
  rule: "New public endpoints must be protected by a feature flag.",
  rationale: "The accepted route adds the repository feature gate.",
  prohibitedSignals: [],
  preferredSignals: ["requireFeature"],
  detection: {
    mode: "missing-required-signal",
    semanticDescription: "A public endpoint is defined without its feature gate.",
    triggerSignals: ["reportsController"],
    forbiddenSignals: [],
    requiredSignals: ["requireFeature"],
    matchScope: "line",
  },
};

function completion(content = JSON.stringify(validAnalysis), status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("semantic response validation", () => {
  it("keeps the runtime prompt identical to the published training prompt", async () => {
    const trainingPrompt = await readFile("training/freesolo/environment/system-prompt.txt", "utf8");
    expect(ENGINEERING_MEMORY_SYSTEM_PROMPT).toBe(trainingPrompt.trim());
  });

  it("accepts a grounded contract and rejects invented signals", () => {
    expect(parseSemanticAnalysis(JSON.stringify(validAnalysis), input)).toMatchObject({
      intent: "architecture",
      detection: { mode: "missing-required-signal" },
    });
    const invented = structuredClone(validAnalysis);
    invented.preferredSignals = ["inventedFeatureGate"];
    invented.detection.requiredSignals = ["inventedFeatureGate"];
    expect(() => parseSemanticAnalysis(JSON.stringify(invented), input)).toThrow(SemanticAnalysisValidationError);
  });

  it("rejects Markdown and inconsistent missing-required signals", () => {
    expect(() => parseSemanticAnalysis(`\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``, input)).toThrow(
      "raw JSON",
    );
    const inconsistent = structuredClone(validAnalysis);
    inconsistent.prohibitedSignals = ["router.get"];
    expect(() => parseSemanticAnalysis(JSON.stringify(inconsistent), input)).toThrow(
      'received ["router.get"]',
    );
  });

  it("normalizes redundant missing-required preferred signals from canonical detection", () => {
    const omitted = structuredClone(validAnalysis);
    omitted.preferredSignals = [];
    const onNormalization = vi.fn();

    expect(parseSemanticAnalysis(JSON.stringify(omitted), input, { onNormalization })).toMatchObject({
      preferredSignals: ["requireFeature"],
      detection: { requiredSignals: ["requireFeature"] },
    });
    expect(onNormalization).toHaveBeenCalledWith({
      reason: "missing-required-preferred-signals",
      originalPreferredSignals: [],
      normalizedPreferredSignals: ["requireFeature"],
    });
  });
});

describe("FreesoloSemanticAnalyzer", () => {
  it("calls the OpenAI-compatible endpoint and returns validated output", async () => {
    const fetchMock = vi.fn(async () => completion());
    const analyzer = new FreesoloSemanticAnalyzer({
      baseUrl: "https://example.test/v1/",
      model: "flash-trained-adapter",
      apiKey: "server-secret",
      fetch: fetchMock as typeof fetch,
      maxRetries: 0,
    });

    await expect(analyzer.analyze(input)).resolves.toMatchObject({ intent: "architecture" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(request.headers).toMatchObject({ authorization: "Bearer server-secret" });
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ model: "flash-trained-adapter", temperature: 0 });
    expect(body.messages).toHaveLength(2);
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      task: "analyze_review_episode",
      version: "1",
      instruction: expect.any(String),
      episode: { repository: "acme/api", pullRequest: 310 },
    });
  });

  it("retries transient responses and not non-retryable authentication failures", async () => {
    const onAttemptFailure = vi.fn();
    const transientFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(completion());
    const retrying = new FreesoloSemanticAnalyzer({
      baseUrl: "https://example.test/v1",
      model: "adapter",
      fetch: transientFetch as typeof fetch,
      maxRetries: 1,
      retryDelayMs: 0,
      onAttemptFailure,
    });
    await expect(retrying.analyze(input)).resolves.toMatchObject({ intent: "architecture" });
    expect(transientFetch).toHaveBeenCalledTimes(2);
    expect(onAttemptFailure).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      maxAttempts: 2,
      willRetry: true,
      input,
    }));

    const unauthorizedFetch = vi.fn(async () => new Response(null, { status: 401 }));
    const unauthorized = new FreesoloSemanticAnalyzer({
      baseUrl: "https://example.test/v1",
      model: "adapter",
      fetch: unauthorizedFetch as typeof fetch,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    await expect(unauthorized.analyze(input)).rejects.toThrow("HTTP 401");
    expect(unauthorizedFetch).toHaveBeenCalledOnce();
  });

  it("aborts a request at the configured timeout", async () => {
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const analyzer = new FreesoloSemanticAnalyzer({
      baseUrl: "https://example.test/v1",
      model: "adapter",
      fetch: fetchMock as typeof fetch,
      timeoutMs: 5,
      maxRetries: 0,
    });
    await expect(analyzer.analyze(input)).rejects.toThrow("1 attempt");
  });
});

describe("analyzer selection and fallback", () => {
  it("defaults to deterministic and fails fast on incomplete Freesolo configuration", () => {
    expect(createSemanticAnalyzerFromEnv({})).toMatchObject({ provider: "deterministic" });
    expect(() => createSemanticAnalyzerFromEnv({ ENGINEERING_MEMORY_SEMANTIC_ANALYZER: "freesolo" })).toThrow(
      "FREESOLO_BASE_URL",
    );
  });

  it("constructs the hosted analyzer from backend environment variables", async () => {
    const fetchMock = vi.fn(async () => completion());
    const analyzer = createSemanticAnalyzerFromEnv({
      ENGINEERING_MEMORY_SEMANTIC_ANALYZER: "freesolo",
      ENGINEERING_MEMORY_SEMANTIC_FALLBACK: "none",
      FREESOLO_BASE_URL: "https://example.test/v1",
      FREESOLO_MODEL: "adapter",
      FREESOLO_API_KEY: "secret",
      FREESOLO_TIMEOUT_MS: "1000",
      FREESOLO_MAX_RETRIES: "0",
      FREESOLO_MAX_CONCURRENCY: "2",
    }, { fetch: fetchMock as typeof fetch });
    expect(analyzer).toMatchObject({ provider: "freesolo", version: "adapter" });
    await expect(analyzer.analyze(input)).resolves.toMatchObject({ intent: "architecture" });
  });

  it("uses deterministic analysis when the hosted analyzer fails", async () => {
    const primary: SemanticAnalyzer = {
      provider: "hosted",
      version: "test",
      analyze: async () => { throw new Error("provider unavailable"); },
    };
    const fallback: SemanticAnalyzer = {
      provider: "deterministic",
      version: "1",
      analyze: async () => ({ ...validAnalysis, intent: "architecture" }),
    };
    const onFallback = vi.fn();
    const analyzer = new FallbackSemanticAnalyzer(primary, fallback, { onFallback });
    await expect(analyzer.analyze(input)).resolves.toMatchObject({ intent: "architecture" });
    expect(onFallback).toHaveBeenCalledOnce();
    expect(analyzer.provider).toBe("hosted-with-deterministic-fallback");
  });
});
