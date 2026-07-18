import "dotenv/config";
import { runConfiguredExtraction } from "./pipeline.js";

async function main(): Promise<void> {
  const result = await runConfiguredExtraction();
  const databaseResult = process.env.DATABASE_URL
    ? `; published ${result.publishedRepositoryCount} repositories to PostgreSQL`
    : "; skipped PostgreSQL (DATABASE_URL is not set)";
  process.stderr.write(
    `Extracted ${result.episodeCount} review episodes into ${result.conventionCount} conventions with ${result.semanticProvider}@${result.semanticVersion}${databaseResult}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
