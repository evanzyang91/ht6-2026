// Entry point for `npm run ingest -- owner/repository`.
//
// Parses `owner/repository` and an optional --limit=N flag.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "./ingest.js";

// npm workspace scripts run with cwd set to this package's directory, not the repo root —
// fix that so relative paths (.env, DATA_DIR=./data) resolve the way .env.example documents.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(REPO_ROOT);

for (const envFile of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // file doesn't exist — fine, GITHUB_TOKEN may already be exported in the shell.
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    throw new Error("Usage: npm run ingest -- owner/repository");
  }
  const limitFlag = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitFlag ? Number(limitFlag.split("=")[1]) : 75;
  const comments = await ingest(target, limit);
  process.stderr.write(`Stored ${comments.length} review comments for ${target}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
