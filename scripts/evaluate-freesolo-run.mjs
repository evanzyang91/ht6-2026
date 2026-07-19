import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [runId, indexArgument] = process.argv.slice(2);
if (!runId) {
  process.stderr.write("Usage: npm run freesolo:evaluate -- <run-id>\n");
  process.exit(2);
}

const root = process.cwd();
const rows = (await readFile(resolve(root, "training/freesolo/environment/dataset/eval.jsonl"), "utf8"))
  .trim().split("\n").map(JSON.parse);
const systemPrompt = (await readFile(resolve(root, "training/freesolo/environment/system-prompt.txt"), "utf8")).trim();
const selectedRows = indexArgument === undefined
  ? [...rows.entries()]
  : [[Number(indexArgument), rows[Number(indexArgument)]]];
if (selectedRows.some(([index, row]) => !Number.isInteger(index) || !row)) {
  throw new Error("Optional evaluation index must identify an existing row");
}

function includesSignal(code, signal) {
  return String(code ?? "").toLowerCase().includes(String(signal).trim().toLowerCase());
}

function violates(detection, code) {
  const context = detection.triggerSignals.length === 0
    || detection.triggerSignals.some((signal) => includesSignal(code, signal));
  if (!context) return false;
  if (detection.mode === "forbidden-signal") {
    return detection.forbiddenSignals.some((signal) => includesSignal(code, signal));
  }
  if (detection.mode === "missing-required-signal") {
    return detection.requiredSignals.length > 0
      && !detection.requiredSignals.some((signal) => includesSignal(code, signal));
  }
  return false;
}

const failures = [];
const warnings = [];
for (const [index, row] of selectedRows) {
  const expected = JSON.parse(row.output);
  const input = JSON.parse(row.input);
  const result = spawnSync("flash", [
    "chat", runId,
    "--temperature", "0",
    "--max-tokens", "500",
    "--system", systemPrompt,
    "-m", row.input,
  ], { encoding: "utf8", timeout: 90_000 });
  if (result.status !== 0) {
    failures.push(`row ${index}: flash chat failed: ${(result.stderr || result.stdout).trim()}`);
    continue;
  }
  const text = result.stdout.trim().replace(/^assistant\s*/i, "").trim();
  let actual;
  try {
    actual = JSON.parse(text);
  } catch {
    failures.push(`row ${index}: response is not raw JSON`);
    continue;
  }
  const topKeys = ["detection", "intent", "rationale", "rule", "title"];
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(topKeys)) {
    failures.push(`row ${index}: top-level v2 keys differ`);
    continue;
  }
  const detection = actual.detection;
  if (!detection || !Array.isArray(detection.triggerSignals)
    || !Array.isArray(detection.forbiddenSignals) || !Array.isArray(detection.requiredSignals)) {
    failures.push(`row ${index}: malformed detection ${JSON.stringify(detection)}`);
    continue;
  }
  if (actual.intent !== expected.intent) failures.push(`row ${index}: intent ${actual.intent} != ${expected.intent}`);
  if (detection.mode !== expected.detection.mode) {
    failures.push(`row ${index}: mode ${detection.mode} != ${expected.detection.mode}`);
  }
  const episode = input.episode;
  const reviewedEvidence = `${episode.rejectedCode ?? ""}\n${episode.codeContext?.reviewedContext ?? ""}`;
  const acceptedEvidence = `${episode.acceptedCode ?? ""}\n${episode.codeContext?.acceptedContext ?? ""}`;
  for (const signal of [...detection.triggerSignals, ...detection.forbiddenSignals]) {
    if (!includesSignal(reviewedEvidence, signal)) failures.push(`row ${index}: ungrounded reviewed signal ${JSON.stringify(signal)}`);
  }
  for (const signal of detection.requiredSignals) {
    if (!includesSignal(acceptedEvidence, signal)) failures.push(`row ${index}: ungrounded accepted signal ${JSON.stringify(signal)}`);
  }
  if (detection.mode !== "semantic") {
    if (!violates(detection, episode.rejectedCode)) failures.push(`row ${index}: rejected code was not detected`);
    if (episode.acceptedCode && violates(detection, episode.acceptedCode)) failures.push(`row ${index}: accepted code was falsely detected`);
  }
  if (JSON.stringify(detection) !== JSON.stringify(expected.detection)) {
    warnings.push(`row ${index}: detection differs from canonical target but was behaviorally checked`);
  }
  process.stdout.write(`row ${index}: ${detection.mode}\n`);
}

process.stdout.write(`\nEvaluated ${selectedRows.length} rows: ${failures.length} failure(s), ${warnings.length} warning(s)\n`);
if (warnings.length) process.stdout.write(`${warnings.map((item) => `WARN ${item}`).join("\n")}\n`);
if (failures.length) {
  process.stderr.write(`${failures.map((item) => `FAIL ${item}`).join("\n")}\n`);
  process.exit(1);
}
