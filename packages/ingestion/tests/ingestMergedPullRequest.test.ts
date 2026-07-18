import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMergedPullRequest = vi.fn();
const fetchReviewComments = vi.fn();
const fetchChangedFilesAndPatches = vi.fn();
const fetchFileContentAtRef = vi.fn();
const storeLoad = vi.fn();
const storeSave = vi.fn();
const markRepositoryIngested = vi.fn();

vi.mock("../src/github/fetchPullRequests.js", () => ({
  fetchMergedPullRequest: (...args: unknown[]) => fetchMergedPullRequest(...args),
  fetchMergedPullRequests: vi.fn(),
}));
vi.mock("../src/github/fetchReviewComments.js", () => ({
  fetchReviewComments: (...args: unknown[]) => fetchReviewComments(...args),
}));
vi.mock("../src/github/fetchPatches.js", () => ({
  fetchChangedFilesAndPatches: (...args: unknown[]) => fetchChangedFilesAndPatches(...args),
}));
vi.mock("../src/github/fetchFileContent.js", () => ({
  fetchFileContentAtRef: (...args: unknown[]) => fetchFileContentAtRef(...args),
}));
vi.mock("../src/storage/index.js", () => ({
  createStore: () => ({ load: storeLoad, save: storeSave }),
}));
vi.mock("@ht6/pipeline", () => ({
  markRepositoryIngested: (...args: unknown[]) => markRepositoryIngested(...args),
}));

const { ingestMergedPullRequest } = await import("../src/ingest.js");

const basePr = { number: 42, title: "Fix thing", mergedAt: "2026-01-01T00:00:00Z", mergeCommitSha: "merge-sha" };

const baseComment = {
  repository: "acme/api",
  pullRequest: 42,
  commentId: "c1",
  reviewer: "sam",
  body: "use the service layer",
  filePath: "src/controller.ts",
  originalCommitSha: "orig-sha",
  createdAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchFileContentAtRef.mockResolvedValue(undefined);
  fetchChangedFilesAndPatches.mockResolvedValue([]);
  storeLoad.mockResolvedValue([]);
});

describe("ingestMergedPullRequest", () => {
  it("rejects a PR that is not merged, without touching storage or pipeline state", async () => {
    fetchMergedPullRequest.mockResolvedValue(undefined);

    await expect(ingestMergedPullRequest("acme/api", 42)).rejects.toThrow("is not merged");
    expect(storeSave).not.toHaveBeenCalled();
    expect(markRepositoryIngested).not.toHaveBeenCalled();
  });

  it("fetches only the merged PR's comments, saves once, and marks the repo ingested", async () => {
    fetchMergedPullRequest.mockResolvedValue(basePr);
    fetchReviewComments.mockResolvedValue([baseComment]);

    const result = await ingestMergedPullRequest("acme/api", 42);

    expect(fetchMergedPullRequest).toHaveBeenCalledWith("acme", "api", 42);
    expect(fetchReviewComments).toHaveBeenCalledWith("acme", "api", 42);
    expect(fetchReviewComments).toHaveBeenCalledTimes(1);
    expect(storeSave).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(markRepositoryIngested).toHaveBeenCalledWith("acme/api", 42, undefined, { changed: true });
  });

  it("handles a merged PR with zero review comments without crashing", async () => {
    fetchMergedPullRequest.mockResolvedValue(basePr);
    fetchReviewComments.mockResolvedValue([]);

    const result = await ingestMergedPullRequest("acme/api", 42);

    expect(result).toEqual([]);
    expect(storeSave).not.toHaveBeenCalled();
    // The PR was still confirmed merged and processed, so bookkeeping still records it —
    // but with no new data, the ingestion version must not bump.
    expect(markRepositoryIngested).toHaveBeenCalledWith("acme/api", 42, undefined, { changed: false });
  });

  it("does not bump the version on a no-op rerun where the comment already existed", async () => {
    fetchMergedPullRequest.mockResolvedValue(basePr);
    fetchReviewComments.mockResolvedValue([baseComment]);
    storeLoad.mockResolvedValue([{
      ...baseComment,
      mergedCommitSha: "merge-sha",
      pullRequestTitle: "Fix thing",
      mergedAt: "2026-01-01T00:00:00Z",
    }]);

    await ingestMergedPullRequest("acme/api", 42);

    expect(storeSave).not.toHaveBeenCalled();
    expect(markRepositoryIngested).toHaveBeenCalledWith("acme/api", 42, undefined, { changed: false });
  });

  it("writes each review record exactly once even if the same comment id is seen twice", async () => {
    fetchMergedPullRequest.mockResolvedValue(basePr);
    fetchReviewComments.mockResolvedValue([baseComment, baseComment]);

    const result = await ingestMergedPullRequest("acme/api", 42);
    expect(result).toHaveLength(1);
  });
});
