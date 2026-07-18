import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawReviewComment } from "@ht6/shared";
import { DEFAULT_DATA_DIR, RAW_COMMENTS_FILE } from "@ht6/shared";
import type { Store } from "./index.js";

function filePath(): string {
  const dataDir = process.env.DATA_DIR ?? DEFAULT_DATA_DIR;
  return path.join(dataDir, RAW_COMMENTS_FILE);
}

async function readAll(): Promise<RawReviewComment[]> {
  try {
    const raw = await readFile(filePath(), "utf-8");
    return JSON.parse(raw) as RawReviewComment[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// Read-merge-write keyed by repository, deduped by commentId, so re-running ingest for the
// same repo never produces duplicate records and other repos' data is left untouched.
export class JsonStore implements Store {
  async load(repository: string): Promise<RawReviewComment[]> {
    const all = await readAll();
    return all.filter((c) => c.repository === repository);
  }

  async save(repository: string, comments: RawReviewComment[]): Promise<void> {
    const all = await readAll();
    const otherRepos = all.filter((c) => c.repository !== repository);

    const byId = new Map<string, RawReviewComment>();
    for (const c of comments) byId.set(c.commentId, c);

    const merged = [...otherRepos, ...byId.values()];
    await mkdir(path.dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(merged, null, 2), "utf-8");
  }
}
