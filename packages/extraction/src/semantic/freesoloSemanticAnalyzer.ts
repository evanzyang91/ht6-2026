import type { SemanticAnalysis, SemanticAnalyzer, SemanticInput } from "./types.js";
import { parseSemanticAnalysis, SemanticAnalysisValidationError } from "./semanticAnalysisValidation.js";

export const ENGINEERING_MEMORY_SYSTEM_PROMPT = `You normalize one pull-request review episode into Engineering Memory JSON.
Return raw JSON only, without Markdown fences or commentary. Use exactly these top-level fields: intent, title, rule, rationale, detection. intent must be one of actionable-change, architecture, testing, security, style, question-nonactionable. Every signal must be the smallest reusable exact code substring, never an English description or an entire code line when a stable identifier is available. detection must contain exactly mode, semanticDescription, triggerSignals, forbiddenSignals, requiredSignals, matchScope. mode must be forbidden-signal, missing-required-signal, or semantic; matchScope must be line or file. Use the English semanticDescription to explain the contextual condition and the signal arrays to encode deterministic detection. The application derives legacy preferredSignals and prohibitedSignals; do not return them.

Choose detection.mode by comparing rejectedCode with acceptedCode:
- Use missing-required-signal when acceptedCode adds a guard, middleware, wrapper, modifier, await, mock, or helper that rejectedCode lacks. In this mode forbiddenSignals must be empty. triggerSignals identify the stable operation or handler that requires the added code. Never mark the trigger itself as forbidden.
- Use forbidden-signal only when rejectedCode contains a disallowed call, import, identifier, or construct that acceptedCode removes or replaces. In this mode detection.requiredSignals must be empty.
- Use semantic only when exact substrings cannot safely represent the condition.

For intent, use security for authentication, authorization, secrets, injection, and direct security controls. Use architecture for layering, lifecycle, release controls such as feature flags, transactions, and component responsibilities. Use codeContext to understand the enclosing symbol and imports, but derive the rule only from the review evidence. Use only supplied evidence and do not invent facts.`;

export const ENGINEERING_MEMORY_USER_INSTRUCTION = "Normalize one pull-request review episode into the Engineering Memory SemanticAnalysis v2 schema. Use only the supplied evidence and return raw JSON without Markdown. Return exactly: intent, title, rule, rationale, detection. intent must be one of actionable-change, architecture, testing, security, style, question-nonactionable. Signals must be exact code substrings, never English descriptions. detection contains mode, semanticDescription, triggerSignals, forbiddenSignals, requiredSignals, matchScope. Use forbidden-signal when code is disallowed in the trigger context, missing-required-signal when the trigger requires absent code, and semantic only when deterministic signals cannot represent the condition. Use codeContext to understand the enclosing symbol and imports, but do not invent repository facts.";

export interface FreesoloSemanticAnalyzerOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxConcurrency?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttemptFailure?: (event: FreesoloAttemptFailure) => void;
}

export interface FreesoloAttemptFailure {
  attempt: number;
  maxAttempts: number;
  willRetry: boolean;
  error: unknown;
  input: SemanticInput;
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

function positiveInteger(value: number | undefined, fallback: number, label: string, allowZero = false): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return resolved;
}

function endpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) throw new Error("FREESOLO_BASE_URL must be an HTTP(S) URL");
  return `${normalized}/chat/completions`;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FreesoloSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider = "freesolo";
  readonly version: string;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly semaphore: Semaphore;
  private readonly onAttemptFailure?: (event: FreesoloAttemptFailure) => void;

  constructor(options: FreesoloSemanticAnalyzerOptions) {
    this.url = endpoint(options.baseUrl);
    this.model = options.model.trim();
    if (!this.model) throw new Error("FREESOLO_MODEL is required");
    this.version = this.model;
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = positiveInteger(options.timeoutMs, 15_000, "FREESOLO_TIMEOUT_MS");
    this.maxRetries = positiveInteger(options.maxRetries, 2, "FREESOLO_MAX_RETRIES", true);
    this.retryDelayMs = positiveInteger(options.retryDelayMs, 250, "FREESOLO_RETRY_DELAY_MS", true);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.semaphore = new Semaphore(positiveInteger(options.maxConcurrency, 4, "FREESOLO_MAX_CONCURRENCY"));
    this.onAttemptFailure = options.onAttemptFailure;
  }

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    return this.semaphore.run(() => this.analyzeWithRetries(input));
  }

  private async analyzeWithRetries(input: SemanticInput): Promise<SemanticAnalysis> {
    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      attempts = attempt + 1;
      try {
        return await this.request(input);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof FreesoloHttpError
          ? retryableStatus(error.status)
          : !(error instanceof SemanticAnalysisValidationError);
        const willRetry = retryable && attempt < this.maxRetries;
        this.onAttemptFailure?.({
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
    throw new Error(`Freesolo analysis failed after ${attempts} attempt(s): ${errorMessage(lastError)}`, {
      cause: lastError,
    });
  }

  private async request(input: SemanticInput): Promise<SemanticAnalysis> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 500,
          messages: [
            { role: "system", content: ENGINEERING_MEMORY_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                task: "analyze_review_episode",
                version: "2",
                instruction: ENGINEERING_MEMORY_USER_INSTRUCTION,
                episode: input,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new FreesoloHttpError(response.status);
      const payload: unknown = await response.json();
      const content = isResponsePayload(payload) ? payload.choices[0]?.message?.content : undefined;
      if (typeof content !== "string") throw new Error("Freesolo response did not contain choices[0].message.content");
      return parseSemanticAnalysis(content, input);
    } finally {
      clearTimeout(timeout);
    }
  }
}

class FreesoloHttpError extends Error {
  constructor(readonly status: number) {
    super(`Freesolo returned HTTP ${status}`);
    this.name = "FreesoloHttpError";
  }
}

function isResponsePayload(value: unknown): value is { choices: Array<{ message?: { content?: unknown } }> } {
  if (typeof value !== "object" || value === null || !("choices" in value)) return false;
  return Array.isArray((value as { choices?: unknown }).choices);
}
