"""Freeze data artifacts and the development choice before the test split runs.

Start this helper before run_experiment.py in another terminal. The experiment
uses a new config runId for every run so the helper cannot attach to stale files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
CONFIG_PATH = Path(__file__).resolve().parent / "config.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def freeze(output: Path) -> dict[str, str]:
    selection = output / "dev-selection.json"
    while not selection.exists():
        time.sleep(0.1)
    lock_path = output / "protocol-lock.json"
    lock = json.loads(lock_path.read_text())
    hashes = {
        "catalog.npz": sha(output / "catalog.npz"),
        "queries.json": sha(output / "queries.json"),
        "fitted-parameters.json": sha(output / "fitted-parameters.json"),
        "dev-selection.json": sha(selection),
    }
    existing = lock.get("frozenArtifactsBeforeTest")
    if existing is not None:
        if existing != hashes:
            raise ValueError("Frozen pre-test hashes already exist and do not match current artifacts")
        return hashes
    lock["frozenArtifactsBeforeTest"] = hashes
    lock["testFreezeAtUtc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lock["freezeProcedure"] = {
        "path": str(Path(__file__).relative_to(ROOT)),
        "sha256": sha(Path(__file__)),
    }
    temporary = lock_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(lock_path)
    return hashes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", help="relative path under .data/recommendation-experiments; defaults to config runId")
    args = parser.parse_args()
    config = json.loads(CONFIG_PATH.read_text())
    output = ROOT / (args.output or f".data/recommendation-experiments/{config['runId']}")
    result = freeze(output)
    print(json.dumps({"frozen": result, "output": str(output.relative_to(ROOT))}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
