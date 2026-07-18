// A general PR conversation-tab comment — not tied to any diff line or formal review (same
// mechanism GitHub uses for issue comments). See raw-comment.ts for the RawComment union.
export interface ConversationComment {
  type: "conversation";
  repository: string;
  pullRequest: number;
  commentId: string;
  /** Who wrote the comment — not necessarily a formal reviewer. */
  reviewer: string;
  body: string;
  createdAt: string;
  /**
   * GitHub's relationship of the commenter to the repository (OWNER, MEMBER, COLLABORATOR,
   * CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE, ...) — a useful signal for weighing whether this
   * comment carries organizational authority.
   */
  authorAssociation?: string;
  pullRequestTitle?: string;
  mergedAt?: string;
  mergedCommitSha?: string;
}
