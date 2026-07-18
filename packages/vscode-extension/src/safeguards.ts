import type { PredictedFeedback } from "@ht6/mcp-server/api" with { "resolution-mode": "import" };

export interface SafeguardSettings {
  minimumConfidence: number;
  minimumPullRequestSupport: number;
  maximumDiagnosticsPerFile: number;
  mutedConventionIds: readonly string[];
}

export interface SafeguardDiagnostics {
  inputCount: number;
  outputCount: number;
  belowConfidence: number;
  insufficientSupport: number;
  muted: number;
  duplicates: number;
  overFileLimit: number;
}

export interface SafeguardResult {
  findings: PredictedFeedback[];
  diagnostics: SafeguardDiagnostics;
}

/** Applies all noise controls after deterministic repository/path/signal validation. */
export function applySafeguards(
  findings: PredictedFeedback[],
  settings: SafeguardSettings,
): PredictedFeedback[] {
  return diagnoseSafeguards(findings, settings).findings;
}

/** Applies safeguards while retaining reason counts for explicit diagnostic commands. */
export function diagnoseSafeguards(
  findings: PredictedFeedback[],
  settings: SafeguardSettings,
): SafeguardResult {
  const diagnostics: SafeguardDiagnostics = {
    inputCount: findings.length,
    outputCount: 0,
    belowConfidence: 0,
    insufficientSupport: 0,
    muted: 0,
    duplicates: 0,
    overFileLimit: 0,
  };
  const muted = new Set(settings.mutedConventionIds);
  const deduplicated = new Map<string, PredictedFeedback>();
  for (const finding of findings) {
    if (finding.confidence < settings.minimumConfidence) {
      diagnostics.belowConfidence += 1;
      continue;
    }
    if (finding.supportCount < settings.minimumPullRequestSupport) {
      diagnostics.insufficientSupport += 1;
      continue;
    }
    if (muted.has(finding.conventionId)) {
      diagnostics.muted += 1;
      continue;
    }
    const key = `${finding.conventionId}:${finding.matchedPath}:${finding.matchedLine ?? 0}`;
    const existing = deduplicated.get(key);
    if (existing) diagnostics.duplicates += 1;
    if (!existing || finding.confidence > existing.confidence) deduplicated.set(key, finding);
  }
  const perFile = new Map<string, number>();
  const accepted = [...deduplicated.values()]
    .sort((a, b) => b.confidence - a.confidence || b.supportCount - a.supportCount)
    .filter((finding) => {
      const count = perFile.get(finding.matchedPath) ?? 0;
      if (count >= settings.maximumDiagnosticsPerFile) {
        diagnostics.overFileLimit += 1;
        return false;
      }
      perFile.set(finding.matchedPath, count + 1);
      return true;
    });
  diagnostics.outputCount = accepted.length;
  return { findings: accepted, diagnostics };
}
