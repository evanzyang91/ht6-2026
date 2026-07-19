import type { SemanticAnalysis, SemanticAnalyzer, SemanticInput } from "./types.js";
import {
  parseSemanticAnalysis,
  SemanticAnalysisValidationError,
  type SemanticDetectionFallback,
} from "./semanticAnalysisValidation.js";
import {
  ENGINEERING_MEMORY_SYSTEM_PROMPT,
  ENGINEERING_MEMORY_USER_INSTRUCTION,
} from "./freesoloSemanticAnalyzer.js";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const GEMINI_SEMANTIC_ANALYSIS_SCHEMA = {
  type: "OBJECT",
  additionalProperties: false,
  properties: {
    intent: {
      type: "STRING",
      enum: ["actionable-change", "architecture", "testing", "security", "style", "question-nonactionable"],
    },
    title: { type: "STRING" },
    rule: { type: "STRING" },
    rationale: { type: "STRING" },
    detection: {
      type: "OBJECT",
      additionalProperties: false,
      properties: {
        mode: { type: "STRING", enum: ["forbidden-signal", "missing-required-signal", "semantic"] },
        semanticDescription: { type: "STRING" },
        triggerSignals: { type: "ARRAY", items: { type: "STRING" } },
        forbiddenSignals: { type: "ARRAY", items: { type: "STRING" } },
        requiredSignals: { type: "ARRAY", items: { type: "STRING" } },
        matchScope: { type: "STRING", enum: ["line", "file"] },
      },
      required: [
        "mode", "semanticDescription", "triggerSignals", "forbiddenSignals", "requiredSignals", "matchScope",
      ],
    },
  },
  required: ["intent", "title", "rule", "rationale", "detection"],
} as const;

export interface GeminiAttemptFailure {
  attempt: number;
  maxAttempts: number;
  willRetry: boolean;
  error: unknown;
  input: SemanticInput;
}

export interface GeminiDetectionFallback extends SemanticDetectionFallback {
  input: SemanticInput;
}

export interface GeminiSemanticAnalyzerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxConcurrency?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttemptFailure?: (event: GeminiAttemptFailure) => void;
  onDetectionFallback?: (event: GeminiDetectionFallback) => void;
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

function integer(value: number | undefined, fallback: number, label: string, allowZero = false): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return result;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class GeminiHttpError extends Error {
  constructor(readonly status: number) {
    super(`Gemini returned HTTP ${status}`);
    this.name = "GeminiHttpError";
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof SemanticAnalysisValidationError) return false;
  if (!(error instanceof GeminiHttpError)) return true;
  return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

function responseText(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("candidates" in value) || !Array.isArray(value.candidates)) {
    return undefined;
  }
  const candidate = value.candidates[0];
  if (typeof candidate !== "object" || candidate === null || !("content" in candidate)) return undefined;
  const content = candidate.content;
  if (typeof content !== "object" || content === null || !("parts" in content) || !Array.isArray(content.parts)) {
    return undefined;
  }
  const parts = content.parts.flatMap((part: unknown) =>
    typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? [part.text] : []
  );
  return parts.length ? parts.join("") : undefined;
}

export class GeminiSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider = "gemini";
  readonly version: string;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly semaphore: Semaphore;

  constructor(private readonly options: GeminiSemanticAnalyzerOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is required");
    this.version = options.model.trim();
    if (!this.version) throw new Error("GEMINI_MODEL is required");
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error("GEMINI_BASE_URL must be an HTTP(S) URL");
    this.url = `${baseUrl}/models/${encodeURIComponent(this.version)}:generateContent`;
    this.timeoutMs = integer(options.timeoutMs, 30_000, "GEMINI_TIMEOUT_MS");
    this.maxRetries = integer(options.maxRetries, 2, "GEMINI_MAX_RETRIES", true);
    this.retryDelayMs = integer(options.retryDelayMs, 250, "GEMINI_RETRY_DELAY_MS", true);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.semaphore = new Semaphore(integer(options.maxConcurrency, 4, "GEMINI_MAX_CONCURRENCY"));
  }

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    return this.semaphore.run(async () => {
      let lastError: unknown;
      let attempts = 0;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        attempts = attempt + 1;
        try {
          return await this.request(input);
        } catch (error) {
          lastError = error;
          const willRetry = retryable(error) && attempt < this.maxRetries;
          this.options.onAttemptFailure?.({
            attempt: attempt + 1,
            maxAttempts: this.maxRetries + 1,
            willRetry,
            error,
            input,
          });
          if (!willRetry) break;
          await this.sleep(this.retryDelayMs * (2 ** attempt));
        }
      }
      throw new Error(`Gemini analysis failed after ${attempts} attempt(s): ${message(lastError)}`, { cause: lastError });
    });
  }

  private async request(input: SemanticInput): Promise<SemanticAnalysis> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ENGINEERING_MEMORY_SYSTEM_PROMPT }] },
          contents: [{
            role: "user",
            parts: [{
              text: JSON.stringify({
                task: "analyze_review_episode",
                version: "2",
                instruction: ENGINEERING_MEMORY_USER_INSTRUCTION,
                episode: input,
              }),
            }],
          }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: GEMINI_SEMANTIC_ANALYSIS_SCHEMA,
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new GeminiHttpError(response.status);
      const text = responseText(await response.json());
      if (!text) throw new Error("Gemini response did not contain candidates[0].content.parts text");
      return parseSemanticAnalysis(text, input, {
        onDetectionFallback: (event) => this.options.onDetectionFallback?.({ ...event, input }),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
