import { describe, expect, it, vi } from "vitest";

vi.mock("../src/github/client.js", () => ({
  createGitHubClient: () => ({
    pulls: {
      listReviews: vi.fn(async () => ({
        data: [
          { id: 1, user: { login: "pat" }, body: "Looks good, approving.", state: "APPROVED", submitted_at: "2026-01-01T00:05:00Z", commit_id: "sha-1" },
          { id: 2, user: { login: "sam" }, body: "", state: "APPROVED", submitted_at: "2026-01-01T00:06:00Z", commit_id: "sha-1" },
          { id: 3, user: { login: "casey" }, body: "Draft, still reviewing", state: "PENDING", submitted_at: null, commit_id: "sha-1" },
          { id: 4, user: { login: "morgan" }, body: "Please add tests before merging.", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01T00:07:00Z", commit_id: "sha-1" },
        ],
      })),
    },
  }),
}));

const { fetchReviewSummaries } = await import("../src/github/fetchReviewSummaries.js");

describe("fetchReviewSummaries", () => {
  it("maps a submitted review with summary text", async () => {
    const reviews = await fetchReviewSummaries("acme", "api", 1);
    expect(reviews.find((r) => r.commentId === "1")).toMatchObject({
      type: "review-summary",
      reviewer: "pat",
      reviewState: "APPROVED",
      reviewCommitSha: "sha-1",
    });
  });

  it("skips a review with no summary text", async () => {
    const reviews = await fetchReviewSummaries("acme", "api", 1);
    expect(reviews.find((r) => r.commentId === "2")).toBeUndefined();
  });

  it("skips a PENDING (not yet submitted) review", async () => {
    const reviews = await fetchReviewSummaries("acme", "api", 1);
    expect(reviews.find((r) => r.commentId === "3")).toBeUndefined();
  });

  it("captures a CHANGES_REQUESTED review with its body", async () => {
    const reviews = await fetchReviewSummaries("acme", "api", 1);
    expect(reviews.find((r) => r.commentId === "4")).toMatchObject({
      reviewState: "CHANGES_REQUESTED",
      body: "Please add tests before merging.",
    });
  });
});
