import { DeterministicSemanticAnalyzer } from "./deterministicSemanticAnalyzer.js";
import { FallbackSemanticAnalyzer } from "./fallbackSemanticAnalyzer.js";
import {
  FreesoloSemanticAnalyzer,
  type FreesoloAttemptFailure,
  type FreesoloDetectionFallback,
  type FreesoloSemanticAnalyzerOptions,
} from "./freesoloSemanticAnalyzer.js";
import { GeminiSemanticAnalyzer, type GeminiSemanticAnalyzerOptions } from "./geminiSemanticAnalyzer.js";
import type { SemanticAnalyzer, SemanticInput } from "./types.js";

export interface SemanticAnalyzerFactoryOptions {
  fetch?: typeof globalThis.fetch;
  onFallback?: (error: unknown, input: SemanticInput) => void;
  onAttemptFailure?: (event: FreesoloAttemptFailure) => void;
  onDetectionFallback?: (event: FreesoloDetectionFallback) => void;
}

function optionalInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

/** Selects the analyzer once per extraction run. Missing hosted configuration fails fast. */
export function createSemanticAnalyzerFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
  options: SemanticAnalyzerFactoryOptions = {},
): SemanticAnalyzer {
  const provider = (environment.ENGINEERING_MEMORY_SEMANTIC_ANALYZER ?? "deterministic").trim().toLowerCase();
  if (provider === "deterministic") return new DeterministicSemanticAnalyzer();
  let primary: SemanticAnalyzer;
  if (provider === "freesolo") {
    if (!environment.FREESOLO_BASE_URL?.trim()) throw new Error("FREESOLO_BASE_URL is required for the Freesolo analyzer");
    if (!environment.FREESOLO_MODEL?.trim()) throw new Error("FREESOLO_MODEL is required for the Freesolo analyzer");
    const freesoloOptions: FreesoloSemanticAnalyzerOptions = {
      baseUrl: environment.FREESOLO_BASE_URL,
      model: environment.FREESOLO_MODEL,
      apiKey: environment.FREESOLO_API_KEY,
      timeoutMs: optionalInteger(environment.FREESOLO_TIMEOUT_MS, "FREESOLO_TIMEOUT_MS"),
      maxRetries: optionalInteger(environment.FREESOLO_MAX_RETRIES, "FREESOLO_MAX_RETRIES"),
      retryDelayMs: optionalInteger(environment.FREESOLO_RETRY_DELAY_MS, "FREESOLO_RETRY_DELAY_MS"),
      maxConcurrency: optionalInteger(environment.FREESOLO_MAX_CONCURRENCY, "FREESOLO_MAX_CONCURRENCY"),
      fetch: options.fetch,
      onAttemptFailure: options.onAttemptFailure,
      onDetectionFallback: options.onDetectionFallback,
    };
    primary = new FreesoloSemanticAnalyzer(freesoloOptions);
  } else if (provider === "gemini") {
    if (!environment.GEMINI_API_KEY?.trim()) throw new Error("GEMINI_API_KEY is required for the Gemini analyzer");
    const geminiOptions: GeminiSemanticAnalyzerOptions = {
      apiKey: environment.GEMINI_API_KEY,
      model: environment.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      baseUrl: environment.GEMINI_BASE_URL,
      timeoutMs: optionalInteger(environment.GEMINI_TIMEOUT_MS, "GEMINI_TIMEOUT_MS"),
      maxRetries: optionalInteger(environment.GEMINI_MAX_RETRIES, "GEMINI_MAX_RETRIES"),
      retryDelayMs: optionalInteger(environment.GEMINI_RETRY_DELAY_MS, "GEMINI_RETRY_DELAY_MS"),
      maxConcurrency: optionalInteger(environment.GEMINI_MAX_CONCURRENCY, "GEMINI_MAX_CONCURRENCY"),
      fetch: options.fetch,
      onAttemptFailure: options.onAttemptFailure,
      onDetectionFallback: options.onDetectionFallback,
    };
    primary = new GeminiSemanticAnalyzer(geminiOptions);
  } else {
    throw new Error(`Unsupported ENGINEERING_MEMORY_SEMANTIC_ANALYZER: ${provider}`);
  }
  const fallbackMode = (environment.ENGINEERING_MEMORY_SEMANTIC_FALLBACK ?? "deterministic").trim().toLowerCase();
  if (fallbackMode === "none") return primary;
  if (fallbackMode !== "deterministic") {
    throw new Error(`Unsupported ENGINEERING_MEMORY_SEMANTIC_FALLBACK: ${fallbackMode}`);
  }
  return new FallbackSemanticAnalyzer(primary, new DeterministicSemanticAnalyzer(), {
    onFallback: (error, input) => options.onFallback?.(error, input),
  });
}
