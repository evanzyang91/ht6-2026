"""Engineering Memory Freesolo environment.

Normalizes one PR review episode into the repository's SemanticAnalysis JSON contract.
Upload this isolated directory with `flash env push --name engineering-memory-sft .`.

A managed run should use the returned [environment] id from
`flash env push --name my-env .`.

The bundled dataset is synthetic and is intended only for a smoke run. Replace it with
human-reviewed rows derived from data/episodes.json before evaluating model quality.
"""

from __future__ import annotations

import json
from pathlib import Path

from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult


DEFAULT_DATASET_PATH = Path(__file__).parent / "dataset" / "train.jsonl"
SYSTEM_PROMPT = (Path(__file__).parent / "system-prompt.txt").read_text().strip()

TOP_LEVEL_KEYS = {"intent", "title", "rule", "rationale", "detection"}
DETECTION_KEYS = {
    "mode", "semanticDescription", "triggerSignals", "forbiddenSignals", "requiredSignals", "matchScope"
}
INTENTS = {
    "actionable-change", "architecture", "testing", "security", "style", "question-nonactionable"
}
DETECTION_MODES = {"forbidden-signal", "missing-required-signal", "semantic"}


def load_jsonl(path: str | Path):
    rows = []
    with Path(path).open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def parse_contract_json(response_text: str):
    text = str(response_text).strip()
    if not text.startswith("{") or not text.endswith("}"):
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict) or set(value) != TOP_LEVEL_KEYS or value.get("intent") not in INTENTS:
        return None
    detection = value.get("detection")
    if not isinstance(detection, dict) or set(detection) != DETECTION_KEYS:
        return None
    if detection.get("mode") not in DETECTION_MODES or detection.get("matchScope") not in {"line", "file"}:
        return None
    for key in ("triggerSignals", "forbiddenSignals", "requiredSignals"):
        if not isinstance(detection.get(key), list) or not all(isinstance(item, str) for item in detection[key]):
            return None
    return value


def exact_match_reward(example: TaskExample, response_text: str) -> RewardResult:
    actual = parse_contract_json(response_text)
    try:
        expected = json.loads(str(example.output or ""))
    except json.JSONDecodeError:
        expected = None
    score = 1.0 if actual is not None and actual == expected else 0.0
    return RewardResult(score=score, threshold=1.0)


class EngineeringMemoryEnv(EnvironmentSingleTurn):
    dataset = load_jsonl(DEFAULT_DATASET_PATH)

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": example.input},
        ]

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return exact_match_reward(example, response_text)


def load_environment(dataset_path: str | None = None, **kwargs) -> EngineeringMemoryEnv:
    env = EngineeringMemoryEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    return env
