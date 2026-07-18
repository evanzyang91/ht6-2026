import type { Convention } from "@ht6/shared";

// TODO (optional/stretch): for conventions that can't be validated by signal-matching alone,
// ask an LLM whether the diff violates the rule. Keep this the single call site for the
// validation LLM so it's easy to swap/disable.
export async function validateWithLlmFallback(
  convention: Convention,
  diff: string
): Promise<boolean> {
  throw new Error("not implemented");
}
