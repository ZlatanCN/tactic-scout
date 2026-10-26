"""Independent read-only audit of the frozen all-position experiment artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable_seed(seed: int, *parts: object) -> int:
    value = ":".join(str(part) for part in (seed, *parts))
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big")


def whitener(covariance: np.ndarray) -> np.ndarray:
    eigenvalues, eigenvectors = np.linalg.eigh(np.asarray(covariance, dtype=np.float64))
    floor = max(float(np.trace(covariance) / covariance.shape[0]) * 1e-10, 1e-12)
    return eigenvectors / np.sqrt(np.maximum(eigenvalues, floor))[None, :]


def independent_distances(family: str, query: np.ndarray, matrix: np.ndarray, fit: dict[str, Any] | None) -> np.ndarray:
    q = np.asarray(query, dtype=np.float64)
    x = np.asarray(matrix, dtype=np.float64)
    delta = x - q
    if family == "mae":
        return np.abs(delta).mean(axis=1)
    if family == "rmse":
        return np.sqrt(np.square(delta).mean(axis=1))
    if family == "weighted_mae":
        return np.abs(delta) @ np.asarray(fit["weights"], dtype=np.float64)
    if family == "zrmse":
        scale = np.asarray(fit["scale"], dtype=np.float64)
        return np.sqrt(np.square(delta / scale).mean(axis=1))
    if family == "mahalanobis":
        covariance = np.asarray(fit["covarianceInfo"]["covariance"], dtype=np.float64)
        transformed = delta @ whitener(covariance)
        return np.sqrt(np.einsum("ij,ij->i", transformed, transformed))
    if family == "cosine":
        qnorm = np.linalg.norm(q)
        xnorm = np.linalg.norm(x, axis=1)
        return np.clip(1.0 - (x @ q) / (xnorm * qnorm), 0.0, 2.0)
    if family == "correlation":
        qc = q - q.mean()
        xc = x - x.mean(axis=1, keepdims=True)
        qnorm = np.linalg.norm(qc)
        xnorm = np.linalg.norm(xc, axis=1)
        qconstant = qnorm <= 1e-12
        xconstant = xnorm <= 1e-12
        if qconstant:
            return np.where(xconstant, 0.0, 1.0)
        scores = np.ones(len(x), dtype=np.float64)
        valid = ~xconstant
        scores[valid] = np.clip(1.0 - (xc[valid] @ qc) / (xnorm[valid] * qnorm), 0.0, 2.0)
        return scores
    raise ValueError(f"Unknown strategy family: {family}")


def make_pool(catalog: dict[str, np.ndarray], scenario: dict[str, Any], refs: list[str]) -> np.ndarray:
    mask = np.ones(len(catalog["ids"]), dtype=bool)
    if scenario["maxAge"] is not None:
        mask &= catalog["ages"] <= scenario["maxAge"]
    if scenario["minCa"] is not None:
        mask &= catalog["ca"] >= scenario["minCa"]
    if scenario.get("minPa") is not None:
        mask &= catalog["pa"] >= scenario["minPa"]
    for identity in refs:
        index = catalog["indexById"].get(identity)
        assert index is not None
        mask[index] = False
    return np.flatnonzero(mask)


def order_indices(scores: np.ndarray, pool: np.ndarray, ids: np.ndarray, k: int) -> np.ndarray:
    return pool[np.lexsort((ids[pool], scores[pool]))[:min(k, len(pool))]]


def verify(output: Path) -> dict[str, Any]:
    lock = json.loads((output / "protocol-lock.json").read_text())
    summary = json.loads((output / "summary.json").read_text())
    query_artifact = json.loads((output / "queries.json").read_text())
    fit_params = json.loads((output / "fitted-parameters.json").read_text())
    config = lock["config"]
    feature_map_path = ROOT / config["featureMapPath"]
    config_path = HERE / "config.json"
    feature_map_bytes = feature_map_path.read_bytes()
    assert sha(config_path) == lock["configSha256"]
    assert sha(feature_map_path) == lock["featureMapSha256"] == config["expectedFeatureMapSha256"]
    assert lock["manifest"]["sha256"] == config["expectedManifestSha256"]
    for filename, digest in lock["codeSha256"].items():
        assert sha(HERE / filename) == digest
    for filename, digest in lock["frozenArtifactsBeforeTest"].items():
        assert sha(output / filename) == digest
    assert lock["testFreezeAtUtc"]
    split_sets = {key: set(value) for key, value in query_artifact["splits"].items()}
    assert not split_sets["fit"] & split_sets["development"]
    assert not split_sets["fit"] & split_sets["test"]
    assert not split_sets["development"] & split_sets["test"]
    queries = query_artifact["queries"]
    query_lookup = {query["queryKey"]: query for rows in queries.values() for query in rows}
    assert len(query_lookup) == len(queries["development"]) + len(queries["test"])
    for split_name, allowed_ids in (("development", split_sets["development"]), ("test", split_sets["test"])):
        seen_references: set[str] = set()
        for query in queries[split_name]:
            assert set(query["referenceIds"]).issubset(allowed_ids)
            assert seen_references.isdisjoint(query["referenceIds"])
            seen_references.update(query["referenceIds"])
    catalogs: dict[str, dict[str, np.ndarray]] = {}
    archive = np.load(output / "catalog.npz", allow_pickle=False)
    feature_map = json.loads(feature_map_bytes)
    for position, definition in feature_map["positions"].items():
        catalogs[position] = {
            "ids": archive[f"ids__{position}"],
            "matrix": archive[f"matrix__{position}"],
            "ages": archive[f"ages__{position}"],
            "ca": archive[f"ca__{position}"],
            "pa": archive[f"pa__{position}"],
            "ratings": archive[f"ratings__{position}"],
            "names": archive[f"names__{position}"],
        }
        catalog = catalogs[position]
        catalog["indexById"] = {identity: index for index, identity in enumerate(catalog["ids"].tolist())}
        assert len(catalog["ids"]) == len(set(catalog["ids"].tolist()))
        assert np.all(catalog["ratings"] >= config["positionRatingMinimum"])
        assert catalog["matrix"].shape[1] == len(definition["groups"][next(iter(definition["groups"]))]) + sum(
            len(values) for key, values in definition["groups"].items() if key != next(iter(definition["groups"]))
        )
        assert np.isfinite(catalog["matrix"]).all()
    fit_by_position = fit_params
    expected_strategies = config["mainStrategies"] + config["controls"]
    expected_rankings = 0
    audited_rankings = 0
    for split_name in ("development", "test"):
        query_rows = queries[split_name]
        query_keys = {query["queryKey"] for query in query_rows}
        expected_count = len(query_rows) * len(config["currentScenarios"]) * len(expected_strategies)
        seen: set[tuple[str, str, str]] = set()
        cached_query_key = None
        cached_scores: dict[str, np.ndarray] = {}
        cached_reference_ids: list[str] = []
        cached_position = ""
        cached_mean_ca = 0.0
        with (output / f"rankings-{split_name}.jsonl").open() as stream:
            for line in stream:
                row = json.loads(line)
                key = (row["queryKey"], row["scenario"], row["strategy"])
                assert row["queryKey"] in query_keys
                assert key not in seen
                seen.add(key)
                query = query_lookup[row["queryKey"]]
                position = row["position"]
                assert query["position"] == position and row["referenceIds"] == query["referenceIds"]
                catalog = catalogs[position]
                if row["queryKey"] != cached_query_key:
                    refs = query["referenceIds"]
                    ref_indices = [catalog["indexById"][identity] for identity in refs]
                    reference = catalog["matrix"][ref_indices].mean(axis=0)
                    cached_mean_ca = float(catalog["ca"][ref_indices].mean())
                    cached_position = position
                    cached_reference_ids = refs
                    cached_scores = {
                        family: independent_distances(family, reference, catalog["matrix"], fit_by_position[position]["families"][family])
                        for family in config["mainStrategies"]
                    }
                    cached_scores["ca_only"] = np.abs(catalog["ca"] - cached_mean_ca)
                    rng = np.random.default_rng(stable_seed(config["seed"], query["queryKey"], "random-control"))
                    cached_scores["random"] = rng.random(len(catalog["ids"]))
                    cached_query_key = row["queryKey"]
                scenario = next(item for item in config["currentScenarios"] if item["id"] == row["scenario"])
                pool = make_pool(catalog, scenario, query["referenceIds"])
                assert row["poolSize"] == len(pool)
                ids = catalog["ids"]
                family = row["strategy"]
                assert cached_position == position and cached_reference_ids == query["referenceIds"]
                scores = cached_scores[family]
                expected_order = order_indices(scores, pool, ids, config["topK"])
                expected_ids = ids[expected_order].tolist()
                assert row["topIds"] == expected_ids
                np.testing.assert_allclose(row["topScores"], scores[expected_order], rtol=1e-10, atol=1e-10)
                assert len(row["topIds"]) == min(config["topK"], len(pool))
                assert not set(row["topIds"]) & set(query["referenceIds"])
                if row["topIds"]:
                    gap = float(np.mean([abs(catalog["ca"][catalog["indexById"][identity]] - cached_mean_ca) for identity in row["topIds"][:5]]))
                    assert abs(gap - row["meanCaGap5"]) < 1e-10
                audited_rankings += 1
        assert len(seen) == expected_count
        expected_rankings += expected_count
        noise = json.loads((output / f"noise-{split_name}.json").read_text())
        assert len(noise) == len(query_rows) * len(expected_strategies)
        assert {(row["queryKey"], row["strategy"]) for row in noise} == {
            (query["queryKey"], strategy) for query in query_rows for strategy in expected_strategies
        }
        for row in noise:
            for key, value in row.items():
                if key.startswith("j5_") or key.startswith("j10_"):
                    assert np.isfinite(value) and 0.0 <= value <= 1.0
    potential_seen = set()
    potential_count = 0
    selection = summary["selection"]
    cached_query_key = None
    cached_potential_scores = np.empty(0)
    with (output / "potential-rankings.jsonl").open() as stream:
        for line in stream:
            row = json.loads(line)
            key = (row["queryKey"], row["scenario"])
            assert key not in potential_seen
            potential_seen.add(key)
            potential_count += 1
            query = query_lookup[row["queryKey"]]
            position = row["position"]
            assert query["position"] == position and row["referenceIds"] == query["referenceIds"]
            catalog = catalogs[position]
            scenario = next(item for item in config["potentialScenarios"] if item["id"] == row["scenario"])
            pool = make_pool(catalog, scenario, query["referenceIds"])
            assert row["poolSize"] == len(pool)
            ids = catalog["ids"]
            if row["queryKey"] != cached_query_key:
                references = [catalog["indexById"][identity] for identity in query["referenceIds"]]
                reference = catalog["matrix"][references].mean(axis=0)
                cached_potential_scores = independent_distances(selection["defaultStrategy"], reference, catalog["matrix"], fit_by_position[position]["families"][selection["defaultStrategy"]])
                cached_query_key = row["queryKey"]
            current_scores = cached_potential_scores
            expected_order = np.lexsort((ids[pool], current_scores[pool], -catalog["pa"][pool]))[:min(config["topK"], len(pool))]
            expected_ids = ids[pool][expected_order].tolist()
            assert row["topIds"] == expected_ids
            assert row["topPa"] == catalog["pa"][pool][expected_order].astype(int).tolist()
            np.testing.assert_allclose(row["currentAttributeDistances"], current_scores[pool][expected_order], rtol=1e-10, atol=1e-10)
            assert not set(row["topIds"]) & set(query["referenceIds"])
    assert potential_count == (len(queries["development"]) + len(queries["test"])) * len(config["potentialScenarios"])
    ablations = json.loads((output / "feature-ablations-test.json").read_text())
    assert len(ablations) == sum(len(feature_map["positions"][q["position"]]["groups"]) for q in queries["test"]) * (1 if selection["defaultStrategy"] == "mae" else 2)
    ablation_context: dict[str, dict[str, Any]] = {}
    for row in ablations:
        query = query_lookup[row["queryKey"]]
        catalog = catalogs[row["position"]]
        assert query["position"] == row["position"]
        position = row["position"]
        context_key = f"{position}/{query['queryKey']}/{row['parentStrategy']}"
        context = ablation_context.get(context_key)
        if context is None:
            references = [catalog["indexById"][identity] for identity in query["referenceIds"]]
            reference = catalog["matrix"][references].mean(axis=0)
            mean_ca = float(catalog["ca"][references].mean())
            ids = catalog["ids"]
            pool = np.flatnonzero(~np.isin(ids, np.asarray(query["referenceIds"], dtype=str)))
            family = row["parentStrategy"]
            if family not in {"mae", "rmse"}:
                raise AssertionError(f"Independent ablation verifier has no frozen subset fitter for {family}")
            full_scores = independent_distances(family, reference, catalog["matrix"], fit_by_position[position]["families"][family])
            parent_top = order_indices(full_scores, pool, ids, 5)
            parent_gap = float(np.mean(np.abs(catalog["ca"][parent_top] - mean_ca))) if len(parent_top) else None
            context = {
                "reference": reference,
                "meanCa": mean_ca,
                "pool": pool,
                "parentTop": parent_top,
                "parentGap": parent_gap,
            }
            ablation_context[context_key] = context
        groups = feature_map["positions"][position]["groups"]
        assert row["removedGroup"] in groups
        removed_features = groups[row["removedGroup"]]
        assert row["removedFeatures"] == removed_features
        keep = np.asarray([index for index, feature in enumerate(sum((v for v in groups.values()), [])) if feature not in set(removed_features)], dtype=np.int64)
        features = sum((v for v in groups.values()), [])
        assert len(features) == catalog["matrix"].shape[1]
        assert row["remainingFeatureCount"] == len(keep)
        reduced_matrix = catalog["matrix"][:, keep]
        reduced_reference = context["reference"][keep]
        ablated_scores = independent_distances(row["parentStrategy"], reduced_reference, reduced_matrix, None)
        ablated_top = order_indices(ablated_scores, context["pool"], catalog["ids"], 5)
        expected_ids = catalog["ids"][ablated_top].tolist()
        assert row["ablatedTopIds"] == expected_ids
        expected_jaccard = len(set(context["parentTop"].tolist()) & set(ablated_top.tolist())) / len(set(context["parentTop"].tolist()) | set(ablated_top.tolist()))
        assert abs(row["top5JaccardAgainstParent"] - expected_jaccard) < 1e-12
        ablated_gap = float(np.mean(np.abs(catalog["ca"][ablated_top] - context["meanCa"]))) if len(ablated_top) else None
        assert abs(row["parentMeanCaGap5"] - context["parentGap"]) < 1e-10
        assert abs(row["ablatedMeanCaGap5"] - ablated_gap) < 1e-10
        assert abs(row["caGapDelta"] - (ablated_gap - context["parentGap"])) < 1e-10
        assert not set(expected_ids) & set(query["referenceIds"])
    dev_choice = json.loads((output / "dev-selection.json").read_text())
    if selection["testConfirmed"]:
        assert selection["defaultStrategy"] == dev_choice["selected"]
        test_item = next(row for row in selection["testComparisons"] if row["strategy"] == dev_choice["selected"])
        assert test_item["passes"]
    else:
        assert selection["defaultStrategy"] == "mae"
    return {
        "passed": True,
        "auditedRankings": audited_rankings,
        "expectedRankings": expected_rankings,
        "positions": len(catalogs),
        "queriesBySplit": {name: len(rows) for name, rows in queries.items()},
        "referenceIdentityIsolation": True,
        "identitySplitDisjoint": True,
        "allFormulaPoolsAndScoresRecomputed": True,
        "filtersSelfExclusionTiesAndStableOrderPassed": True,
        "noiseRowsValidated": True,
        "potentialRowsRecomputedAndSorted": potential_count,
        "ablationRowsValidated": len(ablations),
        "ablationScoresAndTop5Recomputed": True,
        "selectionFreezeAndTestConfirmationPassed": True,
        "frozenArtifactHashesPassed": True,
        "defaultStrategy": selection["defaultStrategy"],
        "verifierSha256": sha(Path(__file__)),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".data/recommendation-experiments/20261025-multiposition-v1")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    result = verify(output)
    write_path = output / "verification.json"
    write_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
