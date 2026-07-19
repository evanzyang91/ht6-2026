import type { ConversationComment, ReviewSummaryComment } from "@ht6/shared";
import { episodeId } from "./extract.js";
import { scoreLinkageQuality } from "./linking/linkageQuality.js";
import type { AnalyzedReviewEpisode, SemanticAnalyzer, SemanticInput } from "./semantic/types.js";

/**
 * Builds an episode from a PR-level comment (an overall review-summary verdict or a general
 * conversation-tab reply) — comment types with no filePath/diffHunk to anchor to at all, unlike
 * analyzeRawComment's inline path. There's nothing to hunk-link or find an accepted fix for, so
 * this skips linkCommentToRejectedHunk/findAcceptedFix/buildReviewCodeContext entirely rather than
 * forcing them through a comment shape that doesn't have the fields they read.
 */
export async function analyzePrLevelComment(
  comment: ReviewSummaryComment | ConversationComment,
  analyzer: SemanticAnalyzer
): Promise<AnalyzedReviewEpisode> {
  const semanticInput: SemanticInput = {
    repository: comment.repository,
    pullRequest: comment.pullRequest,
    filePath: undefined,
    reviewComment: comment.body,
    rejectedCode: undefined,
    acceptedCode: undefined,
    codeContext: undefined,
  };
  const semantics = await analyzer.analyze(semanticInput);
  const episode = {
    id: episodeId(comment),
    repository: comment.repository,
    pullRequest: comment.pullRequest,
    reviewer: comment.reviewer,
    filePath: undefined,
    reviewComment: comment.body,
    rejectedCode: undefined,
    acceptedCode: undefined,
    codeContext: undefined,
    acceptedFixQuality: scoreLinkageQuality("", undefined),
    intent: semantics.intent,
    semanticAnalysis: {
      provider: analyzer.provider,
      version: analyzer.version,
      ...semantics,
    },
    createdAt: comment.createdAt,
  };
  return { episode, semantics };
}
