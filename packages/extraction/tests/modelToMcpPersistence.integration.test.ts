import { afterEach, expect, it } from "vitest";
import type { RawComment, RawReviewComment } from "@ht6/shared";
import { Pool } from "pg";
import { extractComments } from "../src/extract.js";
import { createPrismaExtractionPublisher } from "../src/storage/prismaExtractionPublisher.js";
import type { SemanticAnalyzer } from "../src/semantic/types.js";
import { PostgresConventionStore } from "../../mcp-server/src/store/postgresConventionStore.js";
import { validateAgainstDiff } from "../../mcp-server/src/validation/index.js";

const connectionString = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const repository = "integration/model-to-mcp-detection";
const prLevelRepository = "integration/model-to-mcp-pr-level";

async function removeFixture(slug = repository): Promise<void> {
  if (!connectionString) return;
  const pool = new Pool({ connectionString });
  try {
    await pool.query("DELETE FROM repositories WHERE slug = $1", [slug]);
  } finally {
    await pool.end();
  }
}

afterEach(async () => {
  await removeFixture(repository);
  await removeFixture(prLevelRepository);
});

const integrationTest = connectionString ? it : it.skip;

integrationTest("preserves model detection through conventions, PostgreSQL, and MCP validation", async () => {
  await removeFixture();
  const analyzer: SemanticAnalyzer = {
    provider: "integration-model",
    version: "1",
    async analyze() {
      return {
        intent: "security",
        title: "Authenticate order routes",
        rule: "Order mutation routes must use authentication middleware.",
        rationale: "Mutation routes change protected order state.",
        prohibitedSignals: [],
        preferredSignals: ["requireAuth"],
        detection: {
          mode: "missing-required-signal",
          semanticDescription: "An order mutation route is missing authentication middleware.",
          triggerSignals: ["router.post"],
          forbiddenSignals: [],
          requiredSignals: ["requireAuth"],
          matchScope: "file",
        },
      };
    },
  };
  const comments: RawReviewComment[] = [41, 57].map((pullRequest) => ({
    repository,
    pullRequest,
    commentId: String(pullRequest),
    reviewer: "reviewer",
    body: "This mutation route needs authentication middleware.",
    filePath: `src/routes/orders-${pullRequest}.ts`,
    originalCommitSha: `before-${pullRequest}`,
    mergedCommitSha: `after-${pullRequest}`,
    diffHunk: "@@ -1 +1 @@\n+router.post('/orders', createOrder)",
    acceptedFilePatch: "@@ -1 +1 @@\n-router.post('/orders', createOrder)\n+router.post('/orders', requireAuth, createOrder)",
    createdAt: "2026-07-18T00:00:00Z",
  }));
  const { episodes, conventions } = await extractComments(comments, analyzer);
  expect(conventions).toHaveLength(1);

  const overwrittenConvention = {
    ...conventions[0],
    title: "Authenticate order routes (last write)",
  };
  const publisher = createPrismaExtractionPublisher(connectionString!);
  await publisher.publish({
    comments,
    episodes,
    conventions: [conventions[0], overwrittenConvention],
    analyzerProvider: analyzer.provider,
    analyzerVersion: analyzer.version,
    extractorVersion: "integration-detection-1",
  });
  await publisher.close();

  const store = new PostgresConventionStore(connectionString!);
  try {
    const persisted = await store.all(repository);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      title: "Authenticate order routes (last write)",
      preferredSignals: ["requireAuth"],
      detection: {
        mode: "missing-required-signal",
        triggerSignals: ["router.post"],
        requiredSignals: ["requireAuth"],
        matchScope: "file",
      },
    });

    const findings = await validateAgainstDiff(persisted, [
      "diff --git a/src/routes/orders.ts b/src/routes/orders.ts",
      "--- a/src/routes/orders.ts",
      "+++ b/src/routes/orders.ts",
      "@@ -0,0 +1 @@",
      "+router.post('/orders', createOrder)",
    ].join("\n"));
    expect(findings).toMatchObject([{
      detectionMode: "missing-required-signal",
      matchedSignal: "router.post",
    }]);
  } finally {
    await store.close();
  }
});

integrationTest("persists and serves PR-level (review-summary/conversation) evidence with no file path", async () => {
  await removeFixture(prLevelRepository);
  const comments: RawComment[] = [
    {
      type: "review-summary",
      repository: prLevelRepository,
      pullRequest: 9,
      commentId: "review-9",
      reviewer: "pat",
      body: "This change needs a rollback plan documented before merging.",
      createdAt: "2026-07-19T00:00:00Z",
      reviewState: "CHANGES_REQUESTED",
    },
    {
      type: "conversation",
      repository: prLevelRepository,
      pullRequest: 14,
      commentId: "convo-14",
      reviewer: "casey",
      body: "This change needs a rollback plan documented before merging.",
      createdAt: "2026-07-19T00:05:00Z",
      authorAssociation: "MEMBER",
    },
  ];
  const { episodes, conventions } = await extractComments(comments);
  expect(conventions).toHaveLength(1);
  expect(conventions[0].detection?.mode).toBe("semantic");
  expect(conventions[0].pathScopes).toEqual(["**"]);

  const publisher = createPrismaExtractionPublisher(connectionString!);
  await publisher.publish({
    comments,
    episodes,
    conventions,
    analyzerProvider: "deterministic",
    analyzerVersion: "1",
    extractorVersion: "integration-pr-level-1",
  });
  await publisher.close();

  const store = new PostgresConventionStore(connectionString!);
  try {
    const persisted = await store.all(prLevelRepository);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].evidence).toHaveLength(2);
    for (const evidence of persisted[0].evidence) {
      expect(evidence.filePath).toBeUndefined();
      expect(evidence.rejectedCode).toBeUndefined();
      expect(evidence.reviewComment).toBe("This change needs a rollback plan documented before merging.");
    }
  } finally {
    await store.close();
  }
});
