import { createHash } from "node:crypto";
import type { RawReviewComment, ReviewEpisode } from "@ht6/shared";
import { buildConventionsFromAnalyzedEpisodes } from "./conventions.js";
import { findAcceptedFix } from "./linking/findAcceptedFix.js";
import { linkCommentToRejectedHunk } from "./linking/linkCommentsToHunks.js";
import { scoreLinkageQuality } from "./linking/linkageQuality.js";
import { DeterministicSemanticAnalyzer } from "./semantic/deterministicSemanticAnalyzer.js";
import type { AnalyzedReviewEpisode, SemanticAnalyzer, SemanticInput } from "./semantic/types.js";

export interface ExtractCommentsResult {
  episodes: ReviewEpisode[];
  conventions: ReturnType<typeof buildConventionsFromAnalyzedEpisodes>;
}

function episodeId(comment: RawReviewComment): string {
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
  const semanticInput: SemanticInput = {
    repository: comment.repository,
    pullRequest: comment.pullRequest,
    filePath: comment.filePath,
    reviewComment: comment.body,
    rejectedCode,
    acceptedCode,
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
  comments: RawReviewComment[],
  analyzer: SemanticAnalyzer = new DeterministicSemanticAnalyzer()
): Promise<ExtractCommentsResult> {
  const analyzed = await Promise.all(comments.map((comment) => analyzeRawComment(comment, analyzer)));
  return {
    episodes: analyzed.map(({ episode }) => episode),
    conventions: buildConventionsFromAnalyzedEpisodes(analyzed),
  };
}
