import "dotenv/config";
import { createServer } from "node:http";
import { authorizeGitHubRepository } from "./auth.js";
import { createGraphqlApi } from "./schema.js";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 8790);
const yoga = createGraphqlApi({ authorize: authorizeGitHubRepository });
const server = createServer(yoga);

server.listen(port, host, () => {
  process.stderr.write(`Engineering Memory GraphQL API listening at http://${host}:${port}/graphql\n`);
});
