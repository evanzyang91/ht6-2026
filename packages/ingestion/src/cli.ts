// Entry point for `npm run ingest -- owner/repository`.
//
// TODO: parse `owner/repository` (and any flags, e.g. --limit) from process.argv,
// validate GITHUB_TOKEN is set, then call ingest() from ./ingest.ts.

import { ingest } from "./ingest.js";

async function main(): Promise<void> {
  // TODO: replace with real argv parsing.
  const target = process.argv[2];
  if (!target) {
    throw new Error("Usage: npm run ingest -- owner/repository");
  }
  await ingest(target);
}

main();
