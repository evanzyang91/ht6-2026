import { describe, expect, it, vi } from "vitest";

vi.mock("../src/github/client.js", () => ({
  createGitHubClient: () => ({
    pulls: {
      listFiles: vi.fn(async () => ({
        data: [
          { filename: "src/big.ts", status: "modified", patch: undefined, changes: 5000 },
          {
            filename: "src/new-name.ts",
            previous_filename: "src/old-name.ts",
            status: "renamed",
            patch: "@@ -1 +1 @@\n-a\n+b",
            changes: 2,
          },
          { filename: "src/removed.ts", status: "removed", patch: undefined, changes: 10 },
          { filename: "src/small.ts", status: "modified", patch: "@@ -1 +1 @@\n-x\n+y", changes: 2 },
        ],
      })),
    },
  }),
}));

const { fetchChangedFilesAndPatches } = await import("../src/github/fetchPatches.js");

describe("fetchChangedFilesAndPatches", () => {
  it("flags a large diff whose patch GitHub omitted as truncated", async () => {
    const files = await fetchChangedFilesAndPatches("acme", "api", 1);
    expect(files.find((f) => f.filePath === "src/big.ts")).toMatchObject({ truncated: true, patch: undefined });
  });

  it("captures the previous path for renamed files and does not flag them truncated", async () => {
    const files = await fetchChangedFilesAndPatches("acme", "api", 1);
    expect(files.find((f) => f.filePath === "src/new-name.ts")).toMatchObject({
      previousFilePath: "src/old-name.ts",
      truncated: false,
    });
  });

  it("does not flag a removed file's missing patch as truncated", async () => {
    const files = await fetchChangedFilesAndPatches("acme", "api", 1);
    expect(files.find((f) => f.filePath === "src/removed.ts")).toMatchObject({ truncated: false });
  });

  it("does not flag a normal small patch as truncated", async () => {
    const files = await fetchChangedFilesAndPatches("acme", "api", 1);
    expect(files.find((f) => f.filePath === "src/small.ts")).toMatchObject({ truncated: false });
  });
});
