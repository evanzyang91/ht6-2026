import type { Convention } from "@ht6/shared";

// TODO: filter conventions by path glob and/or language against Convention.pathScopes/languages.
export function filterByScope(
  conventions: Convention[],
  opts: { path?: string; language?: string }
): Convention[] {
  throw new Error("not implemented");
}
