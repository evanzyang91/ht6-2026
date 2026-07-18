import type { LinkageQuality } from "./enums.js";

// Stage 2 (extraction) intermediate output. A RawReviewComment linked to the code it was left
// on and (if found) the code that replaced it. Persisted to data/episodes.json.
export interface ReviewEpisode {
  id: string;
  repository: string;
  pullRequest: number;
  reviewer: string;
  filePath: string;
  reviewComment: string;
  rejectedCode: string;
  acceptedCode?: string;
  acceptedFixQuality: LinkageQuality;
  intent: string;
  createdAt: string;
}
