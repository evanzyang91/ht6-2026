import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMergedPullRequests = vi.fn();
const fetchReviewComments = vi.fn();
const fetchChangedFilesAndPatches = vi.fn();
const fetchFileContentAtRef = vi.fn();
const fetchReviewSummaries = vi.fn();
const fetchConversationComments = vi.fn();
const createStore = vi.fn();
const storeLoad = vi.fn();
const storeSave = vi.fn();
const markRepositoryIngested = vi.fn();

vi.mock("../src/github/fetchPullRequests.js", () => ({
  fetchMergedPullRequest: vi.fn(),
  fetchMergedPullRequests: (...args: unknown[]) => fetchMergedPullRequests(...args),
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
vi.mock("../src/github/fetchReviewSummaries.js", () => ({
  fetchReviewSummaries: (...args: unknown[]) => fetchReviewSummaries(...args),
}));
vi.mock("../src/github/fetchConversationComments.js", () => ({
  fetchConversationComments: (...args: unknown[]) => fetchConversationComments(...args),
}));
vi.mock("../src/storage/index.js", () => ({
  createStore: (...args: unknown[]) => createStore(...args),
}));
vi.mock("@ht6/pipeline", () => ({
  markRepositoryIngested: (...args: unknown[]) => markRepositoryIngested(...args),
}));

const { ingest } = await import("../src/ingest.js");

const oldPr = { number: 41, title: "Old feature", mergedAt: "2025-12-31T00:00:00Z", mergeCommitSha: "old-sha" };
const newPr = { number: 42, title: "New feature", mergedAt: "2026-01-01T00:00:00Z", mergeCommitSha: "new-sha" };

const storedCommentForOldPr = {
  type: "inline" as const,
  repository: "acme/api",
  pullRequest: 41,
  commentId: "c-old",
  reviewer: "sam",
  body: "nit",
  filePath: "src/old.ts",
  originalCommitSha: "orig-sha",
  createdAt: "2025-12-31T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  createStore.mockReturnValue({ load: storeLoad, save: storeSave });
  fetchReviewComments.mockResolvedValue([]);
  fetchChangedFilesAndPatches.mockResolvedValue([]);
  fetchReviewSummaries.mockResolvedValue([]);
  fetchConversationComments.mockResolvedValue([]);
  fetchFileContentAtRef.mockResolvedValue(undefined);
});

describe("ingest() — skipping already-covered PRs", () => {
  it("does not fetch comments/patches for a PR already represented in the store", async () => {
    storeLoad.mockResolvedValue([storedCommentForOldPr]);
    fetchMergedPullRequests.mockResolvedValue([newPr, oldPr]);

    await ingest("acme/api", { limit: 75 });

    // The old PR (41) is already covered — its comment/patch/summary/conversation fetchers
    // should never be called with its number, only the new PR's (42).
    expect(fetchReviewComments).toHaveBeenCalledTimes(1);
    expect(fetchReviewComments).toHaveBeenCalledWith("acme", "api", 42);
    expect(fetchChangedFilesAndPatches).toHaveBeenCalledTimes(1);
    expect(fetchChangedFilesAndPatches).toHaveBeenCalledWith("acme", "api", 42);
    expect(fetchReviewSummaries).toHaveBeenCalledTimes(1);
    expect(fetchConversationComments).toHaveBeenCalledTimes(1);
  });

  it("costs only a PR-list fetch on a rerun where nothing new has merged", async () => {
    storeLoad.mockResolvedValue([storedCommentForOldPr]);
    fetchMergedPullRequests.mockResolvedValue([oldPr]);

    await ingest("acme/api", { limit: 75 });

    expect(fetchMergedPullRequests).toHaveBeenCalledTimes(1);
    expect(fetchReviewComments).not.toHaveBeenCalled();
    expect(fetchChangedFilesAndPatches).not.toHaveBeenCalled();
    expect(fetchReviewSummaries).not.toHaveBeenCalled();
    expect(fetchConversationComments).not.toHaveBeenCalled();
    expect(storeSave).not.toHaveBeenCalled();
    expect(markRepositoryIngested).toHaveBeenCalledWith("acme/api", 41, undefined, { changed: false });
  });

  it("still fetches a merged PR with zero comments every run (known limitation, not a correctness bug)", async () => {
    storeLoad.mockResolvedValue([]);
    fetchMergedPullRequests.mockResolvedValue([oldPr]);

    await ingest("acme/api", { limit: 75 });

    // oldPr has no stored comments, so it's indistinguishable from "never checked" — this is
    // the one case the PR-number skip can't detect. It still costs only cheap empty fetches,
    // not a full re-scrape, and produces no duplicate or incorrect data.
    expect(fetchReviewComments).toHaveBeenCalledWith("acme", "api", 41);
  });
});
