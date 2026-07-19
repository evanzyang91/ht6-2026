import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [indexArgument = "0", responsePath] = process.argv.slice(2);
if (!responsePath) {
  process.stderr.write("Usage: npm run freesolo:check-response -- <eval-index> <response-file>\n");
  process.exit(2);
}
const index = Number(indexArgument);
if (!Number.isInteger(index) || index < 0) throw new Error("Evaluation index must be a non-negative integer");

const evalPath = resolve("training/freesolo/environment/dataset/eval.jsonl");
const rows = (await readFile(evalPath, "utf8")).trim().split("\n").map(JSON.parse);
if (!rows[index]) throw new Error(`Evaluation row ${index} does not exist`);
const expected = JSON.parse(rows[index].output);
const evaluationInput = JSON.parse(rows[index].input);
const episode = evaluationInput.episode;
const cliOutput = await readFile(resolve(responsePath), "utf8");
const modelText = cliOutput.trim().replace(/^assistant\s*\n/, "").trim();
const failures = [];
const warnings = [];

function mismatch(label, actualValue, expectedValue) {
  failures.push(
    `${label} differs\n  actual:   ${JSON.stringify(actualValue)}\n  expected: ${JSON.stringify(expectedValue)}`,
  );
}

function includesSignal(code, signal) {
  return code.toLowerCase().includes(signal.trim().toLowerCase());
}

function deterministicViolation(detection, code) {
  const triggersMatch = detection.triggerSignals.length === 0
    || detection.triggerSignals.some((signal) => includesSignal(code, signal));
  if (!triggersMatch) return false;
  if (detection.mode === "forbidden-signal") {
    return detection.forbiddenSignals.some((signal) => includesSignal(code, signal));
  }
  if (detection.mode === "missing-required-signal") {
    return detection.requiredSignals.length > 0
      && !detection.requiredSignals.some((signal) => includesSignal(code, signal));
  }
  return false;
}

function warnMismatch(label, actualValue, expectedValue) {
  warnings.push(
    `${label} differs from the canonical target\n  actual:   ${JSON.stringify(actualValue)}\n  expected: ${JSON.stringify(expectedValue)}`,
  );
}

if (modelText.startsWith("```")) failures.push("response contains Markdown fences");
let actual;
try {
  actual = JSON.parse(modelText);
} catch {
  failures.push("response is not raw valid JSON");
}

if (actual) {
  const expectedKeys = ["intent", "title", "rule", "rationale", "detection"].sort();
  if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(expectedKeys)) failures.push("top-level keys do not match the contract");
  for (const key of ["intent"]) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      mismatch(key, actual[key], expected[key]);
    }
  }
  const detectionKeys = ["mode", "semanticDescription", "triggerSignals", "forbiddenSignals", "requiredSignals", "matchScope"].sort();
  if (!actual.detection || JSON.stringify(Object.keys(actual.detection).sort()) !== JSON.stringify(detectionKeys)) {
    failures.push("detection keys do not match the contract");
  } else {
    for (const key of ["mode", "triggerSignals", "forbiddenSignals", "requiredSignals", "matchScope"]) {
      if (JSON.stringify(actual.detection[key]) !== JSON.stringify(expected.detection[key])) {
        if (
          ["triggerSignals", "forbiddenSignals", "requiredSignals"].includes(key)
          || (key === "matchScope" && actual.detection.mode === "semantic")
        ) {
          warnMismatch(`detection.${key}`, actual.detection[key], expected.detection[key]);
        } else {
          mismatch(`detection.${key}`, actual.detection[key], expected.detection[key]);
        }
      }
    }

    if (actual.detection.mode !== "semantic") {
      const rejectsReviewedCode = deterministicViolation(actual.detection, episode.rejectedCode ?? "");
      const rejectsAcceptedCode = deterministicViolation(actual.detection, episode.acceptedCode ?? "");
      if (!rejectsReviewedCode) failures.push("behavioral replay did not detect rejectedCode");
      if (episode.acceptedCode && rejectsAcceptedCode) failures.push("behavioral replay falsely detected acceptedCode");
    }
    for (const signal of actual.detection.requiredSignals ?? []) {
      if (episode.acceptedCode && !includesSignal(episode.acceptedCode, signal)) {
        failures.push(`required signal is not present in acceptedCode: ${JSON.stringify(signal)}`);
      }
    }
  }
}

if (failures.length) {
  process.stderr.write(`FAIL eval row ${index}\n- ${failures.join("\n- ")}\n`);
  if (warnings.length) process.stderr.write(`WARNINGS\n- ${warnings.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`PASS eval row ${index}: schema and behavioral replay match\n`);
if (warnings.length) process.stdout.write(`WARNINGS\n- ${warnings.join("\n- ")}\n`);
