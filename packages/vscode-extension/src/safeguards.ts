import type { PredictedFeedback } from "@ht6/mcp-server/api" with { "resolution-mode": "import" };

export interface SafeguardSettings {
  minimumConfidence: number;
  minimumPullRequestSupport: number;
  maximumDiagnosticsPerFile: number;
  mutedConventionIds: readonly string[];
}

/** Applies all noise controls after deterministic repository/path/signal validation. */
export function applySafeguards(
  findings: PredictedFeedback[],
  settings: SafeguardSettings,
): PredictedFeedback[] {
  const muted = new Set(settings.mutedConventionIds);
  const deduplicated = new Map<string, PredictedFeedback>();
  for (const finding of findings) {
    if (finding.confidence < settings.minimumConfidence) continue;
    if (finding.supportCount < settings.minimumPullRequestSupport) continue;
    if (muted.has(finding.conventionId)) continue;
    const key = `${finding.conventionId}:${finding.matchedPath}:${finding.matchedLine ?? 0}`;
    const existing = deduplicated.get(key);
    if (!existing || finding.confidence > existing.confidence) deduplicated.set(key, finding);
  }
  const perFile = new Map<string, number>();
  return [...deduplicated.values()]
    .sort((a, b) => b.confidence - a.confidence || b.supportCount - a.supportCount)
    .filter((finding) => {
      const count = perFile.get(finding.matchedPath) ?? 0;
      if (count >= settings.maximumDiagnosticsPerFile) return false;
      perFile.set(finding.matchedPath, count + 1);
      return true;
    });
}
