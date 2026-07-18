import type { Convention } from "@ht6/shared";
import type { ConventionStore } from "./conventionStore.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Read-only convention store compiled by the extraction stage.
export class JsonConventionStore implements ConventionStore {
  constructor(private readonly filePath = resolve(process.env.DATA_DIR ?? "data", "conventions.json")) {}

  async all(repository: string): Promise<Convention[]> {
    try {
      const conventions = JSON.parse(await readFile(this.filePath, "utf8")) as Convention[];
      return conventions.filter((convention) => convention.repository === repository);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
