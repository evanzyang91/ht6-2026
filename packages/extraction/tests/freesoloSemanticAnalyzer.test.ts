import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  FallbackSemanticAnalyzer,
  ENGINEERING_MEMORY_SYSTEM_PROMPT,
  FreesoloSemanticAnalyzer,
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

  it("accepts a grounded contract and replaces invented detection signals deterministically", () => {
    expect(parseSemanticAnalysis(JSON.stringify(validAnalysis), input)).toMatchObject({
      intent: "architecture",
      detection: { mode: "missing-required-signal" },
    });
    const invented = structuredClone(validAnalysis);
    invented.detection.requiredSignals = ["inventedFeatureGate"];
    expect(parseSemanticAnalysis(JSON.stringify(invented), input)).toMatchObject({
      prohibitedSignals: [],
      preferredSignals: ["requireFeature"],
      detection: {
        mode: "missing-required-signal",
        triggerSignals: ["router.get"],
        requiredSignals: ["requireFeature"],
      },
    });
  });

  it("rejects Markdown and canonicalizes legacy redundant signals", () => {
    expect(() => parseSemanticAnalysis(`\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``, input)).toThrow(
      "raw JSON",
    );
    const legacy = { ...structuredClone(validAnalysis), prohibitedSignals: ["router.get"], preferredSignals: ["wrong"] };
    expect(parseSemanticAnalysis(JSON.stringify(legacy), input)).toMatchObject({
      prohibitedSignals: [],
      preferredSignals: ["requireFeature"],
      detection: { mode: "missing-required-signal" },
    });
  });

  it("replaces executable detection that would also reject the accepted fix", () => {
    const unsafe = {
      ...structuredClone(validAnalysis),
      detection: {
        mode: "forbidden-signal",
        semanticDescription: "Routes are forbidden.",
        triggerSignals: [],
        forbiddenSignals: ["router.get"],
        requiredSignals: [],
        matchScope: "line",
      },
    };
    expect(parseSemanticAnalysis(JSON.stringify(unsafe), input)).toMatchObject({
      prohibitedSignals: [],
      preferredSignals: ["requireFeature"],
      detection: { mode: "missing-required-signal" },
    });
  });

  it("replaces an intent value mistakenly returned as detection.mode and reports why", () => {
    const confused = structuredClone(validAnalysis);
    confused.detection.mode = "architecture";
    const onDetectionFallback = vi.fn();
    expect(parseSemanticAnalysis(JSON.stringify(confused), input, { onDetectionFallback })).toMatchObject({
      intent: "architecture",
      prohibitedSignals: [],
      preferredSignals: ["requireFeature"],
      detection: { mode: "missing-required-signal" },
    });
    expect(onDetectionFallback).toHaveBeenCalledWith({
      reason: "unsupported-mode",
      originalMode: "architecture",
      replacementMode: "missing-required-signal",
    });
  });

  it("keeps an intentional semantic-only detection semantic", () => {
    const semantic = structuredClone(validAnalysis);
    semantic.detection = {
      mode: "semantic",
      semanticDescription: "The naming choice requires contextual judgment.",
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: "line",
    };
    const onDetectionFallback = vi.fn();
    const noExecutableDifference = { ...input, acceptedCode: input.rejectedCode };
    expect(parseSemanticAnalysis(JSON.stringify(semantic), noExecutableDifference, { onDetectionFallback })).toMatchObject({
      detection: { mode: "semantic" },
    });
    expect(onDetectionFallback).not.toHaveBeenCalled();
  });

  it("promotes semantic detection when the code supplies a safe executable difference", () => {
    const semantic = structuredClone(validAnalysis);
    semantic.detection = {
      mode: "semantic",
      semanticDescription: "A route is missing a repository feature gate.",
      triggerSignals: [],
      forbiddenSignals: [],
      requiredSignals: [],
      matchScope: "line",
    };
    const onDetectionFallback = vi.fn();
    expect(parseSemanticAnalysis(JSON.stringify(semantic), input, { onDetectionFallback })).toMatchObject({
      preferredSignals: ["requireFeature"],
      detection: {
        mode: "missing-required-signal",
        triggerSignals: ["router.get"],
        requiredSignals: ["requireFeature"],
      },
    });
    expect(onDetectionFallback).toHaveBeenCalledWith({
      reason: "semantic-executable-opportunity",
      originalMode: "semantic",
      replacementMode: "missing-required-signal",
    });
  });

  it("repairs a copied review comment into context-complete repository knowledge", () => {
    const copied = structuredClone(validAnalysis);
    copied.title = input.reviewComment;
    copied.rule = input.reviewComment;
    const parsed = parseSemanticAnalysis(JSON.stringify(copied), input);
    expect(parsed.rule).not.toBe(input.reviewComment);
    expect(parsed.rule).toContain("Routes");
    expect(parsed.rule).toContain("requireFeature");
    expect(parsed.title).not.toBe(input.reviewComment);
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
      version: "2",
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

  it("does not retry malformed model output and reports the actual attempt count", async () => {
    const malformedFetch = vi.fn(async () => completion("not json"));
    const analyzer = new FreesoloSemanticAnalyzer({
      baseUrl: "https://example.test/v1",
      model: "adapter",
      fetch: malformedFetch as typeof fetch,
      maxRetries: 2,
      retryDelayMs: 0,
    });
    await expect(analyzer.analyze(input)).rejects.toThrow("after 1 attempt(s)");
    expect(malformedFetch).toHaveBeenCalledOnce();
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
