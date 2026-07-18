import type { PredictedFeedback } from "@ht6/mcp-server/api" with { "resolution-mode": "import" };

export interface PopupRecord {
  fingerprint: string;
  shownAt: number;
}

export function findingFingerprint(findings: PredictedFeedback[]): string {
  return findings
    .map((finding) => `${finding.conventionId}:${finding.matchedPath}:${finding.matchedLine ?? 0}`)
    .sort()
    .join("|");
}

export function shouldShowPopup(
  findings: PredictedFeedback[],
  previous: PopupRecord | undefined,
  now: number,
  cooldownMilliseconds: number,
): { show: boolean; record?: PopupRecord } {
  if (!findings.length) return { show: false };
  const fingerprint = findingFingerprint(findings);
  const show = !previous || previous.fingerprint !== fingerprint || now - previous.shownAt >= cooldownMilliseconds;
  return { show, record: show ? { fingerprint, shownAt: now } : previous };
}
