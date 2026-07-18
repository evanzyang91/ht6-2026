import type { CommentIntent } from "@ht6/shared";

// Deterministic first-pass classifier; ambiguous cases are the intended Freesolo seam.
export function classifyIntent(commentBody: string): CommentIntent {
  const text = commentBody.toLowerCase();
  if (/\b(test|mock|fixture|coverage|spec)\b/.test(text)) return "testing";
  if (/\b(auth|permission|security|sanitize|secret|token|xss|csrf|encrypt)\b/.test(text)) return "security";
  if (/\b(architecture|layer|controller|service|repository|dependency|boundary|prisma)\b/.test(text)) return "architecture";
  if (/\b(style|naming|rename|format|lint|readability|typo)\b/.test(text)) return "style";
  if (/^\s*(why|what|how|could you explain)\b.*\?\s*$/i.test(commentBody)) return "question-nonactionable";
  return "actionable-change";
}
