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

interface CliOptions {
  repoSlug: string;
  limit?: number;
  pr?: number;
  force: boolean;
}

const USAGE = "Usage: npm run ingest -- owner/repository [--limit n] [--pr n] [--force]";

function parseArgs(argv: string[]): CliOptions {
  const [repoSlug, ...rest] = argv;
  if (!repoSlug || repoSlug.split("/").length !== 2) {
    throw new Error(USAGE);
  }

  let limit: number | undefined;
  let pr: number | undefined;
  let force = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--limit") {
      limit = Number(rest[++i]);
    } else if (arg === "--pr") {
      pr = Number(rest[++i]);
    } else if (arg === "--force") {
      force = true;
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }

  return { repoSlug, limit, pr, force };
}

async function main(): Promise<void> {
  const { repoSlug, limit, pr, force } = parseArgs(process.argv.slice(2));
  const comments = await ingest(repoSlug, { limit, pr, force });
  console.log(`Ingested ${comments.length} review comments for ${repoSlug}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
