import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { handleGitHubEvent } from "./handleGitHubEvent.js";
import { verifyGitHubSignature } from "./verifyGitHubSignature.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function createWebhookServer(secret = process.env.GITHUB_WEBHOOK_SECRET ?? "") {
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is required");
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}\n');
      return;
    }
    if (request.method !== "POST" || request.url !== "/github/webhook") {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY_BYTES) throw new Error("Webhook payload exceeds 2 MiB");
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks);
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyGitHubSignature(secret, body, typeof signature === "string" ? signature : undefined)) {
        response.writeHead(401, { "content-type": "application/json" }).end('{"error":"invalid signature"}\n');
        return;
      }
      const event = request.headers["x-github-event"];
      const result = await handleGitHubEvent(typeof event === "string" ? event : undefined, body);
      response.writeHead(200, { "content-type": "application/json" }).end(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Webhook failed: ${message}\n`);
      response.writeHead(500, { "content-type": "application/json" }).end(`${JSON.stringify({ error: message })}\n`);
    }
  });
}

async function main(): Promise<void> {
  const port = Number(process.env.WEBHOOK_PORT ?? 8787);
  const host = process.env.WEBHOOK_HOST ?? "127.0.0.1";
  createWebhookServer().listen(port, host, () => {
    process.stderr.write(`GitHub merge webhook listening on http://${host}:${port}/github/webhook\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
