import { createHash } from "node:crypto";
import type { RawComment, RawReviewComment, ReviewEpisode } from "@ht6/shared";
import { buildConventionsFromAnalyzedEpisodes } from "./conventions.js";
import { findAcceptedFix } from "./linking/findAcceptedFix.js";
import { linkCommentToRejectedHunk } from "./linking/linkCommentsToHunks.js";
import { scoreLinkageQuality } from "./linking/linkageQuality.js";
import { buildReviewCodeContext } from "./context/buildReviewCodeContext.js";
import { analyzePrLevelComment } from "./extractPrLevelComment.js";
import { DeterministicSemanticAnalyzer } from "./semantic/deterministicSemanticAnalyzer.js";
import type { AnalyzedReviewEpisode, SemanticAnalyzer, SemanticInput } from "./semantic/types.js";

export interface ExtractCommentsResult {
  episodes: ReviewEpisode[];
  conventions: ReturnType<typeof buildConventionsFromAnalyzedEpisodes>;
}

/** Shared across all comment types (inline, review-summary, conversation) — only needs the fields common to the whole RawComment union. */
export function episodeId(comment: { repository: string; commentId: string }): string {
  return createHash("sha256")
    .update(`${comment.repository}:${comment.commentId}`)
    .digest("hex")
    .slice(0, 16);
}

function mergedPatchRemovesRejectedCode(patch: string | undefined, rejectedCode: string): boolean {
  if (!patch || !rejectedCode.trim()) return false;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const removedCode = patch.split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1))
    .join("\n");
  return normalize(removedCode).includes(normalize(rejectedCode));
}

export async function analyzeRawComment(
  comment: RawReviewComment,
  analyzer: SemanticAnalyzer
): Promise<AnalyzedReviewEpisode> {
  const rejectedCode = linkCommentToRejectedHunk(comment);
  const acceptedCode = findAcceptedFix(comment, rejectedCode);
  const codeContext = buildReviewCodeContext(comment, acceptedCode);
  const semanticInput: SemanticInput = {
    repository: comment.repository,
    pullRequest: comment.pullRequest,
    filePath: comment.filePath,
    reviewComment: comment.body,
    rejectedCode,
    acceptedCode,
    codeContext,
  };
  const semantics = await analyzer.analyze(semanticInput);
  const episode: ReviewEpisode = {
    id: episodeId(comment),
    repository: comment.repository,
    pullRequest: comment.pullRequest,
    reviewer: comment.reviewer,
    filePath: comment.filePath,
    reviewComment: comment.body,
    rejectedCode,
    acceptedCode,
    codeContext,
    acceptedFixQuality: scoreLinkageQuality(rejectedCode, acceptedCode, {
      matchedInMergedPatch: Boolean(
        acceptedCode && mergedPatchRemovesRejectedCode(comment.acceptedFilePatch, rejectedCode)
      ),
    }),
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

export async function extractComments(
  comments: RawComment[],
  analyzer: SemanticAnalyzer = new DeterministicSemanticAnalyzer()
): Promise<ExtractCommentsResult> {
  // Inline and PR-level (review-summary/conversation) comments go through different
  // episode-builders, but must land in one merged array before clustering — clustering has to see
  // every episode type together in a single pass so, e.g., an inline comment and a conversation
  // comment describing the same rule can still cluster into one convention.
  const analyzed = await Promise.all(comments.map((comment) =>
    comment.type === "review-summary" || comment.type === "conversation"
      ? analyzePrLevelComment(comment, analyzer)
      : analyzeRawComment(comment, analyzer)
  ));
  return {
    episodes: analyzed.map(({ episode }) => episode),
    conventions: buildConventionsFromAnalyzedEpisodes(analyzed),
  };
}
