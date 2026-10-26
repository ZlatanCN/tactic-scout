"""Independent artifact audit; does not rerun scoring or select a strategy."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[3]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(output):
    summary = json.loads((output / "summary.json").read_text())
    lock = json.loads((output / "protocol-lock.json").read_text())
    queries = json.loads((output / "queries.json").read_text())
    config = lock["config"]
    fit, dev, test = (set(queries[key]) for key in ("fitIds", "developmentIds", "testIds"))
    assert not fit & dev and not fit & test and not dev & test
    assert len(dev) == len(test) == 120
    assert sha(output / "queries.json") == lock["queryManifestSha256"]
    assert sha(output / "fitted-parameters.json") == lock["fittedParametersSha256"]
    assert sha(output / "dev-selection.json") == summary["selection"]["developmentSelectionSha256"]
    folder = Path(__file__).resolve().parent
    for name, digest in lock["codeSha256"].items():
        assert sha(folder / name) == digest
    assert sha(folder / "config.json") == lock["configSha256"]
    data = np.load(output / "catalog.npz")
    ids, ca, ages = data["ids"], data["ca"], data["ages"]
    by_id = {identity: i for i, identity in enumerate(ids.tolist())}
    assert len(by_id) == len(ids) == lock["data"]["eligibleRows"]
    scenario_pools = {}
    for scenario in config["scenarios"]:
        mask = np.ones(len(ids), dtype=bool)
        if scenario["maxAge"] is not None:
            mask &= ages <= scenario["maxAge"]
        if scenario["minCa"] is not None:
            mask &= ca >= scenario["minCa"]
        scenario_pools[scenario["id"]] = set(ids[mask].tolist())
    checks, totals = 0, {}
    for split, identities in (("development", dev), ("test", test)):
        seen = set()
        with (output / f"rankings-{split}.jsonl").open() as stream:
            for line in stream:
                row = json.loads(line)
                query_id = row["queryId"]
                assert query_id in identities
                key = (query_id, row["scenario"], row["strategy"])
                assert key not in seen
                seen.add(key)
                pool = scenario_pools[row["scenario"]]
                expected_size = len(pool) - int(query_id in pool)
                assert row["poolSize"] == expected_size
                top = row["topIds"]
                assert len(top) == min(10, expected_size) and len(set(top)) == len(top)
                assert set(top).issubset(pool) and query_id not in top
                assert len(top) == len(row["topScores"])
                scores = row["topScores"]
                assert all(np.isfinite(scores))
                assert all(left <= right for left, right in zip(scores, scores[1:]))
                for a, b, left, right in zip(top, top[1:], scores, scores[1:]):
                    if left == right:
                        assert a < b
                if top:
                    gap = float(np.mean([abs(ca[by_id[item]] - ca[by_id[query_id]]) for item in top[:5]]))
                    assert abs(gap - row["meanCaGap5"]) < 1e-10
                checks += 1
        assert len(seen) == len(identities) * len(config["scenarios"]) * len(lock["strategies"])
        totals[split] = len(seen)
        noise = json.loads((output / f"noise-{split}.json").read_text())
        assert len(noise) == len(identities) * len(lock["strategies"])
        assert {(row["queryId"], row["strategy"]) for row in noise} == {
            (identity, strategy) for identity in identities for strategy in lock["strategies"]
        }
    selection = summary["selection"]
    frozen = json.loads((output / "dev-selection.json").read_text())
    assert selection["developmentSelected"] == frozen["selected"]
    if selection["defaultStrategy"] != "mae18":
        assert selection["defaultStrategy"] == frozen["selected"]
        matching = next(row for row in selection["testComparisons"] if row["strategy"] == frozen["selected"])
        assert matching["passes"] and all(matching["checks"].values())
    return {"passed": True, "auditedRankings": checks, "splitRankings": totals,
            "uniqueQueryIdentities": len(dev | test), "fitDevelopmentTestDisjoint": True,
            "allStrategyCandidatePoolsMatched": True, "hardFiltersAndSelfExclusionPassed": True,
            "rankLengthFiniteOrderAndTiesPassed": True, "caGapRecomputedFromCatalog": True,
            "frozenHashesVerified": True, "developmentSelectionRespected": True,
            "defaultStrategy": selection["defaultStrategy"], "verifierSha256": sha(Path(__file__))}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".data/recommendation-experiments/20261025-v1")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    result = verify(output)
    (output / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
