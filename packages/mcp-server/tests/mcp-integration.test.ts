import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

const originalDataDir = process.env.DATA_DIR;
afterEach(() => { process.env.DATA_DIR = originalDataDir; });

it("exposes engineering-memory tools over MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "engineering-memory-mcp-"));
  process.env.DATA_DIR = directory;
  await writeFile(join(directory, "conventions.json"), JSON.stringify([{
    id: "one", repository: "acme/api", title: "Use services", rule: "Controllers use services", rationale: "History",
    category: "architecture", pathScopes: ["**"], languages: [], prohibitedSignals: ["prisma.user.findMany"], preferredSignals: ["userService.list"],
    confidence: 0.9, supportingEpisodes: ["a"], evidence: [{ episodeId: "a", pullRequest: 7, reviewer: "sam", filePath: "x.ts", reviewComment: "Use services", rejectedCode: "prisma.user.findMany()" }],
  }]));
  const server = createServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
    "get_repo_conventions", "find_similar_rejected_patterns", "predict_review_feedback",
    "explain_engineering_decision", "summarize_personal_review_history",
  ]));
  const result = await client.callTool({ name: "get_repo_conventions", arguments: { repository: "acme/api" } });
  expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text" })]));
  const text = (result.content[0] as { type: "text"; text: string }).text;
  const payload = JSON.parse(text) as Array<Record<string, unknown>>;
  expect(payload[0]).toMatchObject({ supportCount: 1, supportingPRs: [7] });
  expect(payload[0]).not.toHaveProperty("evidence");
  await client.close();
  await server.close();
});
