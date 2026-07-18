import type { RawReviewComment } from "./raw-review-comment.js";
import type { ReviewSummaryComment } from "./review-summary-comment.js";
import type { ConversationComment } from "./conversation-comment.js";

// All three PR comment shapes ingestion produces, tagged by `type`. data/raw-comments.json is
// RawComment[] — narrow on `.type` before reading a shape-specific field (e.g. filePath/diffHunk
// only exist on "inline"). Consumers that only care about code-anchored evidence (the current
// extraction pipeline) should filter to `type !== "review-summary" && type !== "conversation"`,
// which also correctly includes older RawReviewComment records that predate this split and have
// no `type` field at all.
export type RawComment = RawReviewComment | ReviewSummaryComment | ConversationComment;
