import type { Convention } from "@ht6/shared";

// Optional provider seam for conventions that cannot be validated by executable signals.
export async function validateWithLlmFallback(
  convention: Convention,
  diff: string
): Promise<boolean> {
  void convention;
  void diff;
  return false;
}
