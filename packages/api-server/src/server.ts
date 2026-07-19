import "dotenv/config";
import { createServer } from "node:http";
import { authorizeGitHubRepository } from "./auth.js";
import {
  decideGitHubWebhook,
  RepositorySyncQueue,
  verifyGitHubWebhookSignature,
} from "./githubWebhook.js";
import { createGraphqlApi, defaultOperations } from "./schema.js";

const MAX_WEBHOOK_BODY_BYTES = 2 * 1024 * 1024;

if (process.env.NODE_ENV === "production") {
  for (const name of [
    "DATABASE_URL",
    "DATABASE_READ_URL",
    "GITHUB_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
  ] as const) {
    if (!process.env[name]) throw new Error(`${name} is required in production`);
  }
}

const host = process.env.API_HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8790);
const webhookToken = process.env.GITHUB_TOKEN ?? "";
const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
const syncLimit = Number(process.env.GITHUB_SYNC_LIMIT ?? 75);
const operations = defaultOperations();
const yoga = createGraphqlApi({ operations, authorize: authorizeGitHubRepository });
const seenDeliveries = new Set<string>();
const syncQueue = new RepositorySyncQueue(
  async (repository) => {
    process.stderr.write(`Automatic repository sync started for ${repository}\n`);
    const result = await operations.sync(repository, webhookToken, syncLimit);
    process.stderr.write(
      `Automatic repository sync completed for ${repository}: ${result.conventionCount} conventions\n`,
    );
  },
  (repository, error) => {
    process.stderr.write(
      `Automatic repository sync failed for ${repository}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  },
);

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}\n');
    return;
  }

  if (request.method === "POST" && request.url === "/github/webhook") {
    if (!webhookToken || !webhookSecret) {
      response.writeHead(503, { "content-type": "application/json" })
        .end('{"error":"automatic sync is not configured"}\n');
      return;
    }

    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_WEBHOOK_BODY_BYTES) throw new Error("Webhook payload exceeds 2 MiB");
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks);
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyGitHubWebhookSignature(
        webhookSecret,
        body,
        typeof signature === "string" ? signature : undefined,
      )) {
        response.writeHead(401, { "content-type": "application/json" }).end('{"error":"invalid signature"}\n');
        return;
      }

      const delivery = request.headers["x-github-delivery"];
      const deliveryId = typeof delivery === "string" ? delivery : undefined;
      if (deliveryId && seenDeliveries.has(deliveryId)) {
        response.writeHead(200, { "content-type": "application/json" })
          .end('{"status":"ignored","reason":"duplicate delivery"}\n');
        return;
      }

      const event = request.headers["x-github-event"];
      const decision = decideGitHubWebhook(typeof event === "string" ? event : undefined, body);
      if (decision.status === "ignored") {
        response.writeHead(200, { "content-type": "application/json" })
          .end(`${JSON.stringify(decision)}\n`);
        return;
      }

      if (deliveryId) {
        seenDeliveries.add(deliveryId);
        if (seenDeliveries.size > 1000) seenDeliveries.delete(seenDeliveries.values().next().value!);
      }
      syncQueue.enqueue(decision.repository);
      response.writeHead(202, { "content-type": "application/json" }).end(`${JSON.stringify({
        status: "queued",
        repository: decision.repository,
        pullRequest: decision.pullRequest,
      })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`GitHub webhook failed: ${message}\n`);
      response.writeHead(400, { "content-type": "application/json" })
        .end(`${JSON.stringify({ error: message })}\n`);
    }
    return;
  }

  await yoga(request, response);
});

server.listen(port, host, () => {
  process.stderr.write(`Engineering Memory GraphQL API listening at http://${host}:${port}/graphql\n`);
});
