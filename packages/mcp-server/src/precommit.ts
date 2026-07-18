import type { Convention } from "@ht6/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { ensureMemoryFresh } from "@ht6/pipeline";
import { createConventionStore } from "./store/conventionStore.js";
import { validateAgainstDiff, type PredictedFeedback } from "./validation/index.js";

const execFileAsync = promisify(execFile);

export interface ReviewCheckResult {
  repository: string;
  threshold: number;
  minimumSupport: number;
  hasStagedChanges: boolean;
  hasMemory: boolean;
  findings: PredictedFeedback[];
  blockers: PredictedFeedback[];
}

export interface ReviewCheckDependencies {
  stagedDiff?: () => Promise<string>;
  remoteUrl?: () => Promise<string>;
  ensureFresh?: (repository: string) => Promise<void>;
  conventions?: (repository: string) => Promise<Convention[]>;
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

async function gitOutput(args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  return result.stdout;
}

export async function runReviewCheck(
  options: { repository?: string; threshold?: number; minimumSupport?: number } = {},
  dependencies: ReviewCheckDependencies = {},
): Promise<ReviewCheckResult> {
  const stagedDiff = await (dependencies.stagedDiff ?? (() => gitOutput(["diff", "--cached", "--no-color", "--unified=3", "--diff-filter=ACMR"])))();
  const threshold = options.threshold ?? 0.8;
  const minimumSupport = options.minimumSupport ?? 2;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Review blocker threshold must be between 0 and 1");
  if (!Number.isInteger(minimumSupport) || minimumSupport < 1) throw new Error("Minimum PR support must be a positive integer");
  const remote = options.repository ? undefined : await (dependencies.remoteUrl ?? (() => gitOutput(["remote", "get-url", "origin"])))();
  const repository = options.repository ?? repositoryFromRemote(remote ?? "");
  if (!repository) throw new Error("Cannot determine repository. Set ENGINEERING_MEMORY_REPOSITORY=owner/repository");
  if (!stagedDiff.trim()) {
    return { repository, threshold, minimumSupport, hasStagedChanges: false, hasMemory: true, findings: [], blockers: [] };
  }

  await (dependencies.ensureFresh ?? ensureMemoryFresh)(repository);
  const conventions = await (dependencies.conventions ?? ((slug) => createConventionStore().all(slug)))(repository);
  if (!conventions.length) {
    return { repository, threshold, minimumSupport, hasStagedChanges: true, hasMemory: false, findings: [], blockers: [] };
  }
  const findings = await validateAgainstDiff(conventions, stagedDiff);
  return {
    repository,
    threshold,
    minimumSupport,
    hasStagedChanges: true,
    hasMemory: true,
    findings,
    blockers: findings.filter((finding) => finding.confidence >= threshold && finding.supportCount >= minimumSupport),
  };
}

export async function publishCommitNotification(
  result: ReviewCheckResult,
  dataDirectory = resolve(process.env.DATA_DIR ?? "data"),
): Promise<void> {
  const target = join(dataDirectory, "commit-review.json");
  if (!result.blockers.length) {
    await rm(target, { force: true });
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({
    repository: result.repository,
    createdAt: new Date().toISOString(),
    findings: result.blockers,
  }, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

function printFinding(finding: PredictedFeedback, blocker: boolean): void {
  const evidence = finding.supportingPRs.map((pullRequest) => `#${pullRequest}`).join(", ") || "no PR numbers available";
  process.stderr.write(`\n${blocker ? "BLOCKER" : "ADVISORY"} ${(finding.confidence * 100).toFixed(0)}% — ${finding.matchedPath}\n`);
  process.stderr.write(`Rule: ${finding.rule}\nReason: ${finding.reason}\nEvidence: ${evidence}\n`);
  if (finding.acceptedExamples[0]) process.stderr.write(`Accepted example:\n${finding.acceptedExamples[0]}\n`);
}

/** Node 18-compatible replacement for process.loadEnvFile (added in later Node releases). */
export async function loadEnvironmentFile(filePath: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trimEnd();
    }
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  await loadEnvironmentFile(resolve(process.cwd(), ".env"));
  const threshold = process.env.ENGINEERING_MEMORY_BLOCK_THRESHOLD
    ? Number(process.env.ENGINEERING_MEMORY_BLOCK_THRESHOLD)
    : undefined;
  const minimumSupport = process.env.ENGINEERING_MEMORY_BLOCK_MIN_SUPPORT
    ? Number(process.env.ENGINEERING_MEMORY_BLOCK_MIN_SUPPORT)
    : undefined;
  const result = await runReviewCheck({
    repository: process.env.ENGINEERING_MEMORY_REPOSITORY,
    threshold,
    minimumSupport,
  });
  await publishCommitNotification(result);
  if (!result.hasStagedChanges) {
    process.stderr.write("Engineering Memory: no staged changes to validate.\n");
    return;
  }
  if (!result.hasMemory) {
    const message = `Engineering Memory: no conventions found for ${result.repository}.`;
    if (process.env.ENGINEERING_MEMORY_REQUIRE_DATA === "true") throw new Error(`${message} Run ingestion before committing.`);
    process.stderr.write(`${message} Check skipped; set ENGINEERING_MEMORY_REQUIRE_DATA=true to fail closed.\n`);
    return;
  }
  if (!result.findings.length) {
    process.stderr.write(`Engineering Memory: no historical review blockers found for ${result.repository}.\n`);
    return;
  }
  for (const finding of result.findings) printFinding(finding, result.blockers.includes(finding));
  if (result.blockers.length) {
    process.stderr.write(`\nEngineering Memory blocked the commit: ${result.blockers.length} finding(s) met the ${result.threshold} confidence and ${result.minimumSupport}-PR support thresholds.\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`\nEngineering Memory: ${result.findings.length} advisory finding(s), none met the blocking threshold.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Engineering Memory check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
