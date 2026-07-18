import type { ReviewEpisode } from "@ht6/shared";

// TODO: given a cluster of episodes, infer pathScopes (e.g. "src/controllers/**") and
// languages (e.g. "ts") to populate Convention.pathScopes / Convention.languages.
export function inferScope(cluster: ReviewEpisode[]): { pathScopes: string[]; languages: string[] } {
  throw new Error("not implemented");
}
