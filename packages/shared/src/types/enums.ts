// How confidently a ReviewEpisode's rejected code was matched to an accepted fix.
// "high" = found in the same PR's merge commit; "medium" = found via heuristic match in a
// later commit; "unknown" = no accepted version could be located.
export type LinkageQuality = "high" | "medium" | "unknown";

// What kind of feedback a review comment represents.
export type CommentIntent =
  | "actionable-change"
  | "architecture"
  | "testing"
  | "security"
  | "style"
  | "question-nonactionable";
