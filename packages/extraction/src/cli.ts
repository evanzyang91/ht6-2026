import { runExtraction } from "./pipeline.js";

async function main(): Promise<void> {
  const result = await runExtraction();
  process.stderr.write(
    `Extracted ${result.episodeCount} review episodes into ${result.conventionCount} conventions with ${result.semanticProvider}@${result.semanticVersion}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
