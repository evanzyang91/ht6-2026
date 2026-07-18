// Entry point for `npm run ingest -- owner/repository`.
//
// Parses `owner/repository` and an optional --limit=N flag.

import { ingest } from "./ingest.js";

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
