import type { ReviewEpisode } from "@ht6/shared";

// Infers a conservative common path prefix and normalized language names. PR-level episodes
// (review-summary/conversation comments, no filePath) are excluded from this computation rather
// than treated as an empty-string path — one PR-level episode mixed into an otherwise well-scoped
// inline cluster would otherwise collapse the whole cluster's common-prefix to "", discarding real
// scope info from its inline siblings. A cluster with no path-bearing episodes at all still
// degrades to the existing pathScopes: ["**"] wildcard below.
export function inferScope(cluster: ReviewEpisode[]): { pathScopes: string[]; languages: string[] } {
  const paths = [...new Set(cluster.flatMap((episode) => episode.filePath ? [episode.filePath] : []))];
  const extensions = paths.map((path) => path.split(".").pop()?.toLowerCase()).filter(Boolean) as string[];
  const languages = [...new Set(extensions.map((extension) => ({
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin",
  }[extension] ?? extension)))];
  const directories = paths.map((path) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const common = directories.reduce((prefix, directory) => {
    const left = prefix.split("/");
    const right = directory.split("/");
    return left.slice(0, left.findIndex((part, index) => part !== right[index]) < 0
      ? Math.min(left.length, right.length)
      : left.findIndex((part, index) => part !== right[index])).join("/");
  }, directories[0] ?? "");
  return { pathScopes: common ? [`${common}/**`] : ["**"], languages };
}
