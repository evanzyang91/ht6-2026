import type { ReviewEpisode } from "@ht6/shared";

// Infers a conservative common path prefix and normalized language names.
export function inferScope(cluster: ReviewEpisode[]): { pathScopes: string[]; languages: string[] } {
  const paths = [...new Set(cluster.map((episode) => episode.filePath))];
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
