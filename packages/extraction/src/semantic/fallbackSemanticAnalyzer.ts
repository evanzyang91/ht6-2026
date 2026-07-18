import type { SemanticAnalysis, SemanticAnalyzer, SemanticInput } from "./types.js";

export interface FallbackSemanticAnalyzerOptions {
  onFallback?: (error: unknown, input: SemanticInput) => void;
}

/** Keeps extraction available when a hosted semantic provider is temporarily unavailable or invalid. */
export class FallbackSemanticAnalyzer implements SemanticAnalyzer {
  readonly provider: string;
  readonly version: string;

  constructor(
    private readonly primary: SemanticAnalyzer,
    private readonly fallback: SemanticAnalyzer,
    private readonly options: FallbackSemanticAnalyzerOptions = {},
  ) {
    this.provider = `${primary.provider}-with-${fallback.provider}-fallback`;
    this.version = `${primary.version}|${fallback.version}`;
  }

  async analyze(input: SemanticInput): Promise<SemanticAnalysis> {
    try {
      return await this.primary.analyze(input);
    } catch (error) {
      this.options.onFallback?.(error, input);
      return this.fallback.analyze(input);
    }
  }
}
