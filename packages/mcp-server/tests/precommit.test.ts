import { expect, it } from "vitest";
import type { Convention } from "@ht6/shared";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvironmentFile, publishCommitNotification, repositoryFromRemote, runReviewCheck } from "../src/precommit.js";

const convention: Convention = {
  id: "prisma",
  repository: "acme/api",
  title: "No Prisma in controllers",
  rule: "Controllers must not access Prisma directly",
  rationale: "Keep persistence behind services",
  category: "architecture",
  pathScopes: ["src/controllers/**"],
  languages: ["typescript"],
  prohibitedSignals: ["prisma.order.create"],
  preferredSignals: ["orderService.create"],
  confidence: 0.91,
  supportingEpisodes: ["episode-142", "episode-207"],
  evidence: [
    {
      episodeId: "episode-142",
      pullRequest: 142,
      reviewer: "sam",
      filePath: "src/controllers/order.ts",
      reviewComment: "Use a service",
      rejectedCode: "prisma.order.create(data)",
      acceptedCode: "orderService.create(data)",
    },
    {
      episodeId: "episode-207",
      pullRequest: 207,
      reviewer: "lee",
      filePath: "src/controllers/invoice.ts",
      reviewComment: "Persistence belongs in the service",
      rejectedCode: "prisma.invoice.create(data)",
      acceptedCode: "invoiceService.create(data)",
    },
  ],
};

it("derives repository slugs from HTTPS and SSH remotes", () => {
  expect(repositoryFromRemote("https://github.com/acme/api.git\n")).toBe("acme/api");
  expect(repositoryFromRemote("git@github.com:acme/api.git")).toBe("acme/api");
});

it("loads hook configuration on Node versions without process.loadEnvFile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-env-"));
  const variable = "ENGINEERING_MEMORY_TEST_COMPATIBILITY";
  try {
    await writeFile(join(directory, ".env"), `${variable}=works\n`, "utf8");
    delete process.env[variable];
    await loadEnvironmentFile(join(directory, ".env"));
    expect(process.env[variable]).toBe("works");
  } finally {
    delete process.env[variable];
    await rm(directory, { recursive: true, force: true });
  }
});

it("blocks a staged diff that violates a high-confidence convention", async () => {
  const result = await runReviewCheck({ threshold: 0.8 }, {
    stagedDiff: async () => "+++ b/src/controllers/order.ts\n+return prisma.order.create(data);\n",
    remoteUrl: async () => "https://github.com/acme/api.git",
    ensureFresh: async () => {},
    conventions: async () => [convention],
  });
  expect(result.blockers).toHaveLength(1);
  expect(result.blockers[0]).toMatchObject({ matchedPath: "src/controllers/order.ts", supportingPRs: [142, 207] });
});

it("keeps a one-off review pattern advisory instead of blocking", async () => {
  const result = await runReviewCheck({ threshold: 0.8, minimumSupport: 3 }, {
    stagedDiff: async () => "+++ b/src/controllers/order.ts\n+return prisma.order.create(data);\n",
    remoteUrl: async () => "https://github.com/acme/api.git",
    ensureFresh: async () => {},
    conventions: async () => [convention],
  });
  expect(result.findings).toHaveLength(1);
  expect(result.blockers).toEqual([]);
});

it("publishes an evidence-backed event for the VS Code commit popup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-commit-"));
  try {
    const result = await runReviewCheck({}, {
      stagedDiff: async () => "+++ b/src/controllers/order.ts\n+return prisma.order.create(data);\n",
      remoteUrl: async () => "https://github.com/acme/api.git",
      ensureFresh: async () => {},
      conventions: async () => [convention],
    });
    await publishCommitNotification(result, directory);
    const payload = JSON.parse(await readFile(join(directory, "commit-review.json"), "utf8"));
    expect(payload).toMatchObject({
      repository: "acme/api",
      findings: [{ conventionId: "prisma", supportingPRs: [142, 207] }],
    });
    expect(payload.createdAt).toEqual(expect.any(String));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("passes unrelated staged changes", async () => {
  const result = await runReviewCheck({}, {
    stagedDiff: async () => "+++ b/src/controllers/order.ts\n+return orderService.create(data);\n",
    remoteUrl: async () => "git@github.com:acme/api.git",
    ensureFresh: async () => {},
    conventions: async () => [convention],
  });
  expect(result.findings).toEqual([]);
  expect(result.blockers).toEqual([]);
});
