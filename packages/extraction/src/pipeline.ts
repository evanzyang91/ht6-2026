import type { RawReviewComment, ReviewEpisode } from "@ht6/shared";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { linkCommentToRejectedHunk } from "./linking/linkCommentsToHunks.js";
import { findAcceptedFix } from "./linking/findAcceptedFix.js";
import { scoreLinkageQuality } from "./linking/linkageQuality.js";
import { classifyIntent } from "./classify/classifyIntent.js";
import { buildConventions } from "./conventions.js";

export interface ExtractionResult {
  episodeCount: number;
  conventionCount: number;
}

/** Rebuilds derived memory atomically from the persisted raw-review snapshot. */
export async function runExtraction(dataDirectory = process.env.DATA_DIR ?? "data"): Promise<ExtractionResult> {
  const dataDir = resolve(dataDirectory);
  const comments = JSON.parse(await readFile(resolve(dataDir, "raw-comments.json"), "utf8")) as RawReviewComment[];
  const episodes: ReviewEpisode[] = comments.map((comment) => {
    const rejectedCode = linkCommentToRejectedHunk(comment);
    const acceptedCode = findAcceptedFix(comment);
    return {
      id: createHash("sha256").update(`${comment.repository}:${comment.commentId}`).digest("hex").slice(0, 16),
      repository: comment.repository,
      pullRequest: comment.pullRequest,
      reviewer: comment.reviewer,
      filePath: comment.filePath,
      reviewComment: comment.body,
      rejectedCode,
      acceptedCode,
      acceptedFixQuality: scoreLinkageQuality(rejectedCode, acceptedCode),
      intent: classifyIntent(comment.body),
      createdAt: comment.createdAt,
    };
  });
  const conventions = buildConventions(episodes);
  await mkdir(dataDir, { recursive: true });
  for (const [name, value] of [["episodes.json", episodes], ["conventions.json", conventions]] as const) {
    const target = resolve(dataDir, name);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  }
  return { episodeCount: episodes.length, conventionCount: conventions.length };
}
