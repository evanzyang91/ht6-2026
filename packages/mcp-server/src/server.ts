import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { createConventionStore } from "./store/conventionStore.js";
import { createToolDefinitions } from "./tools/index.js";

export function createServer() {
  const server = new McpServer({ name: "engineering-memory", version: "0.1.0" });
  const store = createConventionStore();
  // The SDK's registerTool generic expands every schema in a heterogeneous tuple; erase the
  // tuple here while retaining runtime Zod validation for each registered tool.
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: { description: string; inputSchema: Record<string, unknown> },
    callback: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
  ) => void;
  for (const tool of createToolDefinitions(store)) {
    registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async (input) => {
      const result = await tool.run(input as never);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
  }
  return server;
}

async function main(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
