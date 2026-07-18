import type { RawComment } from "@ht6/shared";
import type { Store } from "./index.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Atomic read-merge-write store keyed by repository and GitHub comment ID.
export class JsonStore implements Store {
  constructor(private readonly filePath = resolve(process.env.DATA_DIR ?? "data", "raw-comments.json")) {}

  async load(repository: string): Promise<RawComment[]> {
    try {
      const all = JSON.parse(await readFile(this.filePath, "utf8")) as RawComment[];
      return all.filter((comment) => comment.repository === repository);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(repository: string, comments: RawComment[]): Promise<void> {
    let all: RawComment[] = [];
    try { all = JSON.parse(await readFile(this.filePath, "utf8")) as RawComment[]; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const otherRepos = all.filter((comment) => comment.repository !== repository);
    const unique = new Map(comments.map((comment) => [comment.commentId, comment]));
    const next = [...otherRepos, ...unique.values()];
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, this.filePath);
  }
}
