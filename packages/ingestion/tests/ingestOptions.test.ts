import { beforeEach, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  createStore.mockReturnValue({ load: storeLoad, save: storeSave });
  storeLoad.mockResolvedValue([]);
  fetchReviewComments.mockResolvedValue([]);
  fetchChangedFilesAndPatches.mockResolvedValue([]);
  fetchReviewSummaries.mockResolvedValue([]);
  fetchConversationComments.mockResolvedValue([]);
  fetchFileContentAtRef.mockResolvedValue(undefined);
  fetchMergedPullRequests.mockResolvedValue([{
    number: 42,
    title: "Merged feature",
    mergedAt: "2026-01-01T00:00:00Z",
    mergeCommitSha: "merge-sha",
  }]);
});

it("uses injected-auth initialization options without persisting the token", async () => {
  const progress = vi.fn();
  await ingest("acme/api", {
    token: "ephemeral-token",
    dataDirectory: "/tmp/engineering-memory-test",
    limit: 10,
    persistEmptySnapshot: true,
    onProgress: progress,
  });

  expect(createStore).toHaveBeenCalledWith("/tmp/engineering-memory-test");
  expect(fetchMergedPullRequests).toHaveBeenCalledWith("acme", "api", 10);
  expect(markRepositoryIngested).toHaveBeenCalledWith(
    "acme/api",
    42,
    "/tmp/engineering-memory-test",
    { changed: false },
  );
  expect(storeSave).toHaveBeenCalledWith("acme/api", []);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "fetching-pull-requests" }));
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "complete" }));
  expect(JSON.stringify(createStore.mock.calls)).not.toContain("ephemeral-token");
  expect(JSON.stringify(markRepositoryIngested.mock.calls)).not.toContain("ephemeral-token");
});
