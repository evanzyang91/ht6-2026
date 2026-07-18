import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { relative } from "node:path";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[], acceptFailure = false): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    if (acceptFailure && error && typeof error === "object" && "stdout" in error) return String(error.stdout ?? "");
    throw error;
  }
}

export function repositoryFromRemote(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^[^@]+@[^:]+:(.+\/.+)$/);
  if (ssh) return ssh[1];
  try {
    const url = new URL(trimmed);
    return url.pathname.replace(/^\//, "") || undefined;
  } catch {
    return undefined;
  }
}

export async function repositoryForWorkspace(root: string): Promise<string | undefined> {
  return repositoryFromRemote(await git(root, ["remote", "get-url", "origin"]));
}

export async function diffForFile(root: string, absolutePath: string, contents: string): Promise<string> {
  const path = relative(root, absolutePath).replaceAll("\\", "/");
  const tracked = await git(root, ["ls-files", "--error-unmatch", "--", path], true);
  if (tracked.trim()) return git(root, ["diff", "HEAD", "--no-color", "--unified=3", "--", path]);
  const lines = contents.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

export async function stagedDiff(root: string): Promise<string> {
  return git(root, ["diff", "--cached", "--no-color", "--unified=3", "--diff-filter=ACMR"]);
}
