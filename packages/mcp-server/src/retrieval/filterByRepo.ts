import type { Convention } from "@ht6/shared";

// Repository is a hard tenant boundary, not a ranking signal.
export function filterByRepo(conventions: Convention[], repository: string): Convention[] {
  const normalized = repository.toLowerCase();
  return conventions.filter((convention) => convention.repository.toLowerCase() === normalized);
}
