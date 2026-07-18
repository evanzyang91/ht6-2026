import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { inspectRepositoryMemory } from "../src/api.js";
import { markRepositoryExtracted, markRepositoryIngested, markRepositoryMemoryFailed } from "@ht6/pipeline";

it("distinguishes unprocessed, stale, empty, ready, and failed repository memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-status-"));
  expect(await inspectRepositoryMemory("acme/api", { dataDirectory: directory }))
    .toMatchObject({ status: "unprocessed", conventionCount: 0 });

  await markRepositoryIngested("acme/api", 42, directory);
  expect(await inspectRepositoryMemory("acme/api", { dataDirectory: directory }))
    .toMatchObject({ status: "stale" });

  await markRepositoryExtracted("acme/api", 1, directory);
  expect(await inspectRepositoryMemory("acme/api", { dataDirectory: directory }))
    .toMatchObject({ status: "empty", conventionCount: 0 });

  await writeFile(join(directory, "conventions.json"), JSON.stringify([{
    id: "no-prisma",
    repository: "acme/api",
    title: "Use services",
    rule: "Controllers use services.",
    rationale: "Repeated review feedback.",
    category: "architecture",
    pathScopes: ["src/controllers/**"],
    languages: ["typescript"],
    prohibitedSignals: ["prisma.user.findMany"],
    preferredSignals: ["userService.list"],
    confidence: 0.9,
    supportingEpisodes: ["a", "b"],
    evidence: [],
  }]));
  expect(await inspectRepositoryMemory("acme/api", { dataDirectory: directory }))
    .toMatchObject({ status: "ready", conventionCount: 1 });

  await markRepositoryMemoryFailed("acme/api", "GitHub denied access", directory);
  expect(await inspectRepositoryMemory("acme/api", { dataDirectory: directory }))
    .toMatchObject({ status: "failed", lastError: "GitHub denied access" });
});

