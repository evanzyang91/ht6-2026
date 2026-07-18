import { describe, expect, it, vi } from "vitest";

vi.mock("../src/github/client.js", () => ({
  createGitHubClient: () => ({
    issues: {
      listComments: vi.fn(async () => ({
        data: [
          { id: 10, user: { login: "casey" }, body: "Do we need a migration for this?", created_at: "2026-01-01T00:02:00Z", author_association: "MEMBER" },
          { id: 11, user: { login: "bot" }, body: "   ", created_at: "2026-01-01T00:03:00Z", author_association: "NONE" },
          { id: 12, user: null, body: "Thanks for the fix!", created_at: "2026-01-01T00:04:00Z", author_association: "FIRST_TIME_CONTRIBUTOR" },
        ],
      })),
    },
  }),
}));

const { fetchConversationComments } = await import("../src/github/fetchConversationComments.js");

describe("fetchConversationComments", () => {
  it("maps a conversation comment with its author association", async () => {
    const comments = await fetchConversationComments("acme", "api", 1);
    expect(comments.find((c) => c.commentId === "10")).toMatchObject({
      type: "conversation",
      reviewer: "casey",
      authorAssociation: "MEMBER",
    });
  });

  it("skips a whitespace-only comment", async () => {
    const comments = await fetchConversationComments("acme", "api", 1);
    expect(comments.find((c) => c.commentId === "11")).toBeUndefined();
  });

  it("falls back to 'unknown' when the author account is missing", async () => {
    const comments = await fetchConversationComments("acme", "api", 1);
    expect(comments.find((c) => c.commentId === "12")).toMatchObject({ reviewer: "unknown" });
  });
});
