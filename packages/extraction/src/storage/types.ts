import type { Convention, RawReviewComment, ReviewEpisode } from "@ht6/shared";

export interface ExtractionSnapshot {
  comments: RawReviewComment[];
  episodes: ReviewEpisode[];
  conventions: Convention[];
  analyzerProvider: string;
  analyzerVersion: string;
  extractorVersion: string;
}

export interface ExtractionPublishResult {
  repositoryCount: number;
}

/** Persistence boundary owned by extraction; ingestion never receives this capability. */
export interface ExtractionPublisher {
  publish(snapshot: ExtractionSnapshot): Promise<ExtractionPublishResult>;
  close?(): Promise<void>;
}
