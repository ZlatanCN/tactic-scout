"""Offline all-position FM formula comparison. Local read-only data; no model or network calls."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import resource
import sqlite3
import sys
import time
import zlib
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from metrics import distances, fit_strategy, numeric_checks

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"
RAW_ATTRIBUTE_NAMES = (
    "acceleration", "aerial_reach", "aggression", "agility", "anticipation", "balance",
    "bravery", "command_of_area", "communication", "composure", "concentration", "consistency",
    "corners", "crossing", "decisions", "determination", "dirtiness", "dribbling", "eccentricity",
    "finishing", "first_touch", "flair", "free_kick_taking", "handling", "heading", "important_matches",
    "injury_proneness", "jumping_reach", "kicking", "leadership", "long_shots", "long_throws", "marking",
    "natural_fitness", "off_the_ball", "one_on_ones", "pace", "passing", "penalty_taking", "positioning",
    "punching", "reflexes", "rushing_out", "stamina", "strength", "tackling", "teamwork", "technique",
    "throwing", "versatility", "vision", "work_rate",
)


def log(message: str) -> None:
    print(message, flush=True)


def sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_seed(seed: int, *parts: object) -> int:
    value = ":".join(str(part) for part in (seed, *parts))
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big")


def json_default(value: Any) -> Any:
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=json_default, allow_nan=False) + "\n")


def connect_readonly(path: Path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return closing(connection)


def number(value: Any) -> float:
    if value is None or value == "":
        raise ValueError("missing numeric source field")
    result = float(value)
    if not np.isfinite(result):
        raise ValueError("nonfinite numeric source field")
    return result


def age_on(birth_date: str, as_of: date) -> int:
    born = date.fromisoformat(birth_date)
    return as_of.year - born.year - ((as_of.month, as_of.day) < (born.month, born.day))


def validate_feature_map(feature_map: dict[str, Any]) -> dict[str, dict[str, Any]]:
    positions = feature_map.get("positions", {})
    expected = {"gk", "dl", "dc", "dr", "wbl", "dm", "wbr", "ml", "mc", "mr", "aml", "amc", "amr", "stc"}
    if set(positions) != expected:
        raise ValueError(f"Feature map must cover exactly {sorted(expected)}")
    if "sw" not in feature_map.get("unsupportedPositions", {}):
        raise ValueError("SW must be explicitly marked unavailable")
    for position, definition in positions.items():
        groups = definition.get("groups", {})
        if len(groups) < 2:
            raise ValueError(f"{position} needs at least two explainable feature groups")
        flattened = [feature for group in groups.values() for feature in group]
        if not flattened or len(flattened) != len(set(flattened)):
            raise ValueError(f"{position} groups must partition distinct features")
        unknown = set(flattened) - set(RAW_ATTRIBUTE_NAMES)
        if unknown:
            raise ValueError(f"{position} uses unknown raw fields: {sorted(unknown)}")
    return positions


def load_dataset(config: dict[str, Any], feature_map: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    path = ROOT / ".data/fm/profiles-v2.sqlite"
    manifest: dict[str, Any]
    profile_ids: list[str] = []
    record_ids: list[str] = []
    names: list[str] = []
    ages: list[int] = []
    cas: list[float] = []
    pas: list[float] = []
    raw_rows: list[list[float]] = []
    record_index: dict[str, int] = {}
    excluded: Counter[str] = Counter()
    position_records: dict[str, list[tuple[int, int]]] = defaultdict(list)
    with connect_readonly(path) as connection:
        manifest = json.loads(connection.execute("SELECT payload FROM manifest WHERE id=1").fetchone()[0])
        if manifest["sha256"] != config["expectedManifestSha256"]:
            raise ValueError("FM manifest changed; create and freeze a new experiment config")
        snapshot_date = date.fromisoformat(manifest["inGameDate"])
        rows = connection.execute("SELECT record_id, unique_id, name, birth_date, payload FROM players ORDER BY unique_id, record_id").fetchall()
        for row_index, row in enumerate(rows):
            record_id = str(row["record_id"])
            profile = json.loads(zlib.decompress(row["payload"], -15))
            raw = [number(profile.get("raw_attributes_" + attribute)) for attribute in RAW_ATTRIBUTE_NAMES]
            if any(value < 1 or value > 100 for value in raw):
                raise ValueError(f"Raw attribute outside 1-100 in record {record_id}")
            unique_id = row["unique_id"]
            if unique_id in (None, ""):
                excluded["missing_fm_id"] += 1
                continue
            stable_id = str(unique_id)
            if stable_id in record_index:
                raise ValueError(f"Duplicate FM unique_id {stable_id}")
            try:
                ca = number(profile.get("ability_current"))
                pa = number(profile.get("ability_potential"))
                birth = profile.get("birth_date") or row["birth_date"]
                age = age_on(birth, snapshot_date)
            except (ValueError, TypeError) as error:
                raise ValueError(f"Invalid CA/PA/birth date for {stable_id}") from error
            if not (1 <= ca <= 200 and 1 <= pa <= 200):
                raise ValueError(f"CA or PA outside declared scale for {stable_id}")
            chosen_name = profile.get("common_name") or profile.get("full_name") or profile.get("name") or row["name"] or stable_id
            record_index[record_id] = len(profile_ids)
            profile_ids.append(stable_id)
            record_ids.append(record_id)
            names.append(str(chosen_name))
            ages.append(age)
            cas.append(ca)
            pas.append(pa)
            raw_rows.append(raw)
            if row_index and row_index % 25000 == 0:
                log(f"Loaded {row_index}/{len(rows)} FM rows")
        position_rows = connection.execute("SELECT position, record_id, rating FROM positions ORDER BY position, record_id").fetchall()
        for row in position_rows:
            position, record_id = str(row["position"]), str(row["record_id"])
            if position not in feature_map["positions"] and position != "sw":
                continue
            if record_id not in record_index:
                continue
            position_records[position].append((record_index[record_id], int(row["rating"])))
    if len(profile_ids) != len(set(profile_ids)):
        raise ValueError("Stable FM IDs are not unique")
    all_ids = np.asarray(profile_ids, dtype=str)
    matrix = np.asarray(raw_rows, dtype=np.float64)
    if matrix.shape != (len(all_ids), len(RAW_ATTRIBUTE_NAMES)) or not np.isfinite(matrix).all():
        raise ValueError("FM raw attribute matrix is incomplete or nonfinite")
    profile_data = {
        "ids": all_ids,
        "recordIds": np.asarray(record_ids, dtype=str),
        "names": np.asarray(names, dtype=str),
        "ages": np.asarray(ages, dtype=np.int16),
        "ca": np.asarray(cas, dtype=np.float64),
        "pa": np.asarray(pas, dtype=np.float64),
        "raw": matrix,
        "recordIndex": record_index,
        "positionRecords": position_records,
        "attributeIndex": {name: i for i, name in enumerate(RAW_ATTRIBUTE_NAMES)},
    }
    counts = {}
    catalogs = {}
    for position, definition in feature_map["positions"].items():
        position_rows_for_role = position_records.get(position, [])
        rating_counts = Counter(rating for _, rating in position_rows_for_role)
        eligible = [(index, rating) for index, rating in position_rows_for_role if rating >= config["positionRatingMinimum"]]
        eligible.sort(key=lambda item: all_ids[item[0]])
        features = [feature for group in definition["groups"].values() for feature in group]
        feature_indices = np.asarray([profile_data["attributeIndex"][feature] for feature in features], dtype=np.int64)
        indices = np.asarray([index for index, _ in eligible], dtype=np.int64)
        ratings = np.asarray([rating for _, rating in eligible], dtype=np.int16)
        catalogs[position] = {
            "ids": all_ids[indices],
            "globalIndices": indices,
            "names": profile_data["names"][indices],
            "ages": profile_data["ages"][indices],
            "ca": profile_data["ca"][indices],
            "pa": profile_data["pa"][indices],
            "ratings": ratings,
            "matrix": matrix[indices][:, feature_indices],
            "features": features,
            "groups": definition["groups"],
        }
        catalogs[position]["indexById"] = {identity: i for i, identity in enumerate(catalogs[position]["ids"].tolist())}
        counts[position] = {
            "allPositionRowsWithId": len(position_rows_for_role),
            "ratingAtLeast15": len(eligible),
            "ratingAt20": int(rating_counts[20]),
            "ratingDistribution": {str(key): int(value) for key, value in sorted(rating_counts.items())},
            "featureCount": len(features),
            "featureGroups": {key: len(value) for key, value in definition["groups"].items()},
            "fitRowsPotential": int(np.sum(np.isin(all_ids, all_ids))),
        }
    sw_eligible = sum(rating >= config["positionRatingMinimum"] for _, rating in position_records.get("sw", []))
    if sw_eligible != 0:
        raise ValueError("SW position became eligible; feature map must be revised before running")
    data_info = {
        "profileRows": len(rows),
        "eligibleProfilesWithFmId": len(all_ids),
        "excluded": dict(excluded),
        "attributeCount": len(RAW_ATTRIBUTE_NAMES),
        "attributeValuesValidated": int(matrix.size),
        "positions": counts,
        "swRatingAtLeast15": sw_eligible,
        "sqliteSha256": sha_file(path),
        "sqliteBytes": path.stat().st_size,
        "snapshotDate": manifest["inGameDate"],
    }
    return {"profileData": profile_data, "catalogs": catalogs, "manifest": manifest}, data_info


def split_identities(ids: np.ndarray, config: dict[str, Any]) -> dict[str, set[str]]:
    rng = np.random.default_rng(config["seed"])
    shuffled = rng.permutation(ids)
    n = len(shuffled)
    fit_end = int(n * config["fitFraction"])
    dev_end = fit_end + int(n * config["developmentFraction"])
    splits = {
        "fit": set(shuffled[:fit_end].tolist()),
        "development": set(shuffled[fit_end:dev_end].tolist()),
        "test": set(shuffled[dev_end:].tolist()),
    }
    if set.union(*splits.values()) != set(ids.tolist()) or any(splits[a] & splits[b] for a,b in (("fit","development"),("fit","test"),("development","test"))):
        raise AssertionError("Identity split is not disjoint and complete")
    return splits


def create_queries(catalogs: dict[str, dict[str, Any]], splits: dict[str, set[str]], config: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    queries: dict[str, list[dict[str, Any]]] = {"development": [], "test": []}
    for split_name in ("development", "test"):
        split_ids = splits[split_name]
        reserved: set[str] = set()
        order = sorted(catalogs, key=lambda pos: int(np.sum(np.isin(catalogs[pos]["ids"], list(split_ids)))))
        role_queries: dict[str, list[dict[str, Any]]] = {}
        for position in order:
            catalog = catalogs[position]
            available = [identity for identity in catalog["ids"].tolist() if identity in split_ids and identity not in reserved]
            needed = config["singleQueriesPerPositionPerSplit"] + 2 * config["twoReferenceQueriesPerPositionPerSplit"] + 3 * config["threeReferenceQueriesPerPositionPerSplit"]
            if len(available) < needed:
                raise ValueError(f"{position}/{split_name} can sample only {len(available)} disjoint query identities; need {needed}")
            rng = np.random.default_rng(stable_seed(config["seed"], split_name, position, "reference-sampling"))
            available = np.asarray(available, dtype=str)[rng.permutation(len(available))].tolist()
            cursor = 0
            groups = []
            for index in range(config["singleQueriesPerPositionPerSplit"]):
                groups.append(("single", available[cursor:cursor + 1]))
                cursor += 1
            for index in range(config["twoReferenceQueriesPerPositionPerSplit"]):
                groups.append(("multi2", available[cursor:cursor + 2]))
                cursor += 2
            for index in range(config["threeReferenceQueriesPerPositionPerSplit"]):
                groups.append(("multi3", available[cursor:cursor + 3]))
                cursor += 3
            if any(len(group_ids) != (1 if kind == "single" else 2 if kind == "multi2" else 3) for kind, group_ids in groups):
                raise ValueError(f"Failed to form reference groups for {position}/{split_name}")
            reserved.update(identity for _, group_ids in groups for identity in group_ids)
            role_queries[position] = [
                {"queryKey": f"{position}/{split_name}/{index:03d}", "position": position, "split": split_name,
                 "kind": kind, "referenceIds": group_ids}
                for index, (kind, group_ids) in enumerate(groups)
            ]
        for position in catalogs:
            queries[split_name].extend(role_queries[position])
    return queries


def build_fit_parameters(catalogs: dict[str, dict[str, Any]], fit_ids: set[str]) -> tuple[dict[str, dict[str, dict[str, Any]]], dict[str, Any]]:
    all_fits, summary = {}, {}
    for position, catalog in catalogs.items():
        mask = np.isin(catalog["ids"], list(fit_ids))
        fit_matrix = catalog["matrix"][mask]
        if len(fit_matrix) < 100:
            raise ValueError(f"Too few fit profiles for {position}: {len(fit_matrix)}")
        all_fits[position] = {}
        for family in ("mae", "rmse", "cosine", "correlation", "zrmse", "mahalanobis", "weighted_mae"):
            all_fits[position][family] = fit_strategy(family, fit_matrix, catalog["groups"], catalog["features"])
        summary[position] = {
            "fitRows": len(fit_matrix),
            "features": catalog["features"],
            "groups": catalog["groups"],
            "families": {family: {key: value for key, value in fit.items() if key not in {"whitener"}} for family, fit in all_fits[position].items()},
        }
    return all_fits, summary


def scenario_pool(catalog: dict[str, Any], scenario: dict[str, Any], reference_ids: list[str]) -> np.ndarray:
    mask = np.ones(len(catalog["ids"]), dtype=bool)
    if scenario["maxAge"] is not None:
        mask &= catalog["ages"] <= scenario["maxAge"]
    if scenario["minCa"] is not None:
        mask &= catalog["ca"] >= scenario["minCa"]
    if scenario.get("minPa") is not None:
        mask &= catalog["pa"] >= scenario["minPa"]
    for identity in reference_ids:
        index = catalog["indexById"].get(identity)
        if index is None:
            raise ValueError("Reference set contains a player who is not eligible for target position")
        mask[index] = False
    return np.flatnonzero(mask)


def rank(scores: np.ndarray, pool: np.ndarray, ids: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(scores, dtype=np.float64)
    pool = np.asarray(pool, dtype=np.int64)
    if not np.isfinite(values[pool]).all():
        raise ValueError("A ranking score is nonfinite")
    order = np.lexsort((ids[pool], values[pool]))[:min(k, len(pool))]
    picked = pool[order]
    return picked, values[picked]


def jaccard(left: np.ndarray, right: np.ndarray, k: int) -> float:
    a, b = set(left[:k].tolist()), set(right[:k].tolist())
    return len(a & b) / len(a | b) if a or b else 1.0


def query_vector(query: dict[str, Any], catalog: dict[str, Any]) -> tuple[np.ndarray, float]:
    reference_indices = [catalog["indexById"][identity] for identity in query["referenceIds"]]
    return catalog["matrix"][reference_indices].mean(axis=0), float(catalog["ca"][reference_indices].mean())


def all_strategy_scores(query_key: str, reference: np.ndarray, mean_ca: float, catalog: dict[str, Any], fit_parameters: dict[str, dict[str, Any]], config: dict[str, Any]) -> dict[str, np.ndarray]:
    matrix = catalog["matrix"]
    outputs = {}
    for family in config["mainStrategies"]:
        outputs[family] = distances(family, reference, matrix, fit_parameters[family])
    outputs["ca_only"] = np.abs(catalog["ca"] - mean_ca)
    rng = np.random.default_rng(stable_seed(config["seed"], query_key, "random-control"))
    outputs["random"] = rng.random(len(catalog["ids"]))
    return outputs


def noisy_vectors(reference: np.ndarray, query_key: str, groups: dict[str, list[str]], features: list[str], config: dict[str, Any]) -> list[tuple[str, np.ndarray]]:
    values: list[tuple[str, np.ndarray]] = []
    for amount in (1, 2):
        for replica in range(config["noiseReplicates"]):
            rng = np.random.default_rng(stable_seed(config["seed"], query_key, amount, replica))
            changed = np.clip(reference + rng.integers(-amount, amount + 1, len(reference)), 1, 100)
            values.append((f"pm{amount}", changed))
    feature_index = {feature: index for index, feature in enumerate(features)}
    for group_name, names in groups.items():
        changed = reference.copy()
        rng = np.random.default_rng(stable_seed(config["seed"], query_key, "group", group_name))
        shift = int(rng.choice((-2, 2)))
        indices = [feature_index[name] for name in names]
        changed[indices] = np.clip(changed[indices] + shift, 1, 100)
        values.append((f"group:{group_name}", changed))
    return values


def evaluate_split(split_name: str, queries: list[dict[str, Any]], catalogs: dict[str, dict[str, Any]], fits: dict[str, dict[str, dict[str, Any]]], config: dict[str, Any], output: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    ranking_path = output / f"rankings-{split_name}.jsonl"
    strategy_names = config["mainStrategies"] + config["controls"]
    noise_rows: list[dict[str, Any]] = []
    diagnostics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    position_queries = Counter()
    with ranking_path.open("w") as stream:
        for ordinal, query in enumerate(queries, start=1):
            position = query["position"]
            catalog = catalogs[position]
            reference, mean_ca = query_vector(query, catalog)
            scores = all_strategy_scores(query["queryKey"], reference, mean_ca, catalog, fits[position], config)
            scenario_pools = {scenario["id"]: scenario_pool(catalog, scenario, query["referenceIds"]) for scenario in config["currentScenarios"]}
            base_top: dict[str, np.ndarray] = {}
            for scenario in config["currentScenarios"]:
                pool = scenario_pools[scenario["id"]]
                for strategy in strategy_names:
                    top, top_scores = rank(scores[strategy], pool, catalog["ids"], config["topK"])
                    if len(top) != len(set(top.tolist())) or set(catalog["ids"][top].tolist()) & set(query["referenceIds"]):
                        raise AssertionError("Duplicate or self-referenced candidate in ranking")
                    row = {
                        "split": split_name,
                        "position": position,
                        "queryKey": query["queryKey"],
                        "queryKind": query["kind"],
                        "referenceIds": query["referenceIds"],
                        "meanReferenceCa": mean_ca,
                        "scenario": scenario["id"],
                        "poolSize": len(pool),
                        "strategy": strategy,
                        "topIds": catalog["ids"][top].tolist(),
                        "topScores": top_scores.tolist(),
                        "meanCaGap5": float(np.mean(np.abs(catalog["ca"][top[:5]] - mean_ca))) if len(top) else None,
                    }
                    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                    if scenario["id"] == "open":
                        base_top[strategy] = top
                        diagnostics[position][strategy].append(row["meanCaGap5"])
            position_queries[position] += 1
            noise_accum: dict[str, dict[str, list[float]]] = {strategy: defaultdict(list) for strategy in strategy_names}
            open_pool = scenario_pools["open"]
            for label, changed in noisy_vectors(reference, query["queryKey"], catalog["groups"], catalog["features"], config):
                noisy_scores = all_strategy_scores(query["queryKey"], changed, mean_ca, catalog, fits[position], config)
                for strategy in strategy_names:
                    perturbed_top, _ = rank(noisy_scores[strategy], open_pool, catalog["ids"], config["topK"])
                    noise_accum[strategy][f"j5_{label}"].append(jaccard(base_top[strategy], perturbed_top, 5))
                    noise_accum[strategy][f"j10_{label}"].append(jaccard(base_top[strategy], perturbed_top, 10))
            for strategy in strategy_names:
                values = {key: float(np.mean(items)) for key, items in noise_accum[strategy].items()}
                row = {"split": split_name, "position": position, "queryKey": query["queryKey"], "queryKind": query["kind"], "strategy": strategy, **values}
                noise_rows.append(row)
            if ordinal % 25 == 0:
                log(f"{split_name}: {ordinal}/{len(queries)} queries")
    write_json(output / f"noise-{split_name}.json", noise_rows)
    return noise_rows, diagnostics, {"queryCountsByPosition": dict(position_queries), "rankingRows": len(queries) * len(config["currentScenarios"]) * len(strategy_names)}


def macro_values(noise_rows: list[dict[str, Any]], field: str, strategy: str) -> tuple[float, dict[str, float]]:
    by_position: dict[str, list[float]] = defaultdict(list)
    for row in noise_rows:
        if row["strategy"] == strategy:
            by_position[row["position"]].append(float(row[field]))
    per_position = {position: float(np.mean(values)) for position, values in by_position.items()}
    return float(np.mean(list(per_position.values()))), per_position


def paired_macro_bootstrap(noise_rows: list[dict[str, Any]], baseline: str, challenger: str, field: str, config: dict[str, Any], salt: str) -> dict[str, Any]:
    by_position: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    for row in noise_rows:
        if row["strategy"] in {baseline, challenger}:
            by_position[row["position"]][row["queryKey"]][row["strategy"]] = float(row[field])
    differences = {}
    for position, queries in by_position.items():
        differences[position] = np.asarray([
            values[challenger] - values[baseline]
            for values in queries.values()
            if baseline in values and challenger in values
        ], dtype=np.float64)
    if not differences or any(len(values) == 0 for values in differences.values()):
        raise ValueError("Paired macro bootstrap needs both methods for every position")
    mean = float(np.mean([values.mean() for values in differences.values()]))
    rng = np.random.default_rng(stable_seed(config["seed"], "macro-paired-bootstrap", salt))
    samples = np.empty(config["bootstrapReplicates"], dtype=np.float64)
    positions = sorted(differences)
    for replicate in range(config["bootstrapReplicates"]):
        position_means = []
        for position in positions:
            values = differences[position]
            indices = rng.integers(0, len(values), len(values))
            position_means.append(values[indices].mean())
        samples[replicate] = np.mean(position_means)
    return {
        "mean": mean,
        "low95": float(np.quantile(samples, 0.025)),
        "high95": float(np.quantile(samples, 0.975)),
        "queryGroups": int(sum(len(values) for values in differences.values())),
        "positionMeans": {position: float(values.mean()) for position, values in differences.items()},
    }


def timing_benchmark(queries: list[dict[str, Any]], catalogs: dict[str, dict[str, Any]], fits: dict[str, dict[str, dict[str, Any]]], config: dict[str, Any]) -> dict[str, Any]:
    observations: dict[str, list[float]] = defaultdict(list)
    for query in queries:
        if query["kind"] != "single":
            continue
        position = query["position"]
        catalog = catalogs[position]
        reference, mean_ca = query_vector(query, catalog)
        pool = scenario_pool(catalog, config["currentScenarios"][0], query["referenceIds"])
        for strategy in config["mainStrategies"] + config["controls"]:
            start = time.perf_counter_ns()
            if strategy in config["mainStrategies"]:
                scores = distances(strategy, reference, catalog["matrix"], fits[position][strategy])
            elif strategy == "ca_only":
                scores = np.abs(catalog["ca"] - mean_ca)
            else:
                scores = np.random.default_rng(stable_seed(config["seed"], query["queryKey"], "random-control")).random(len(catalog["ids"]))
            rank(scores, pool, catalog["ids"], config["topK"])
            observations[strategy].append((time.perf_counter_ns() - start) / 1_000_000)
    return {
        strategy: {
            "p50Milliseconds": float(np.quantile(values, 0.50)),
            "p95Milliseconds": float(np.quantile(values, 0.95)),
            "measurements": len(values),
            "measurementScope": "in-memory score + stable topK across all positions; excludes SQLite and LLM",
        }
        for strategy, values in observations.items()
    }


def choose_global(noise_rows: list[dict[str, Any]], timing: dict[str, Any], config: dict[str, Any], split_name: str) -> dict[str, Any]:
    comparisons = []
    for strategy in config["selectionStrategies"]:
        delta = paired_macro_bootstrap(noise_rows, "mae", strategy, "j5_pm2", config, f"{split_name}:{strategy}")
        macro, per_position = macro_values(noise_rows, "j5_pm2", strategy)
        per_position_delta = delta["positionMeans"]
        passes = (
            delta["mean"] >= config["minimumMacroJaccardGain"]
            and delta["low95"] > 0.0
            and min(per_position_delta.values()) >= config["maximumPerPositionJaccardRegression"]
            and timing[strategy]["p95Milliseconds"] < config["maximumP95Milliseconds"]
        )
        comparisons.append({
            "strategy": strategy,
            "macroJ5pm2": macro,
            "jaccardDelta": delta,
            "minimumPositionDelta": min(per_position_delta.values()),
            "perPositionJ5pm2": per_position,
            "p95Milliseconds": timing[strategy]["p95Milliseconds"],
            "passes": bool(passes),
        })
    passing = [row for row in comparisons if row["passes"]]
    if passing:
        priority = {name: index for index, name in enumerate(("rmse", "zrmse", "weighted_mae", "mahalanobis"))}
        selected = sorted(passing, key=lambda row: (-row["macroJ5pm2"], priority[row["strategy"]]))[0]["strategy"]
        status = "provisional"
    else:
        selected = "mae"
        status = "inconclusive"
    return {"split": split_name, "selected": selected, "status": status, "comparisons": comparisons}


def potential_order(catalog: dict[str, Any], pool: np.ndarray, current_scores: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    # Primary: highest PA. Secondary: smallest current-profile distance. Tertiary: stable FM ID.
    order = np.lexsort((catalog["ids"][pool], current_scores[pool], -catalog["pa"][pool]))[:min(k, len(pool))]
    selected = pool[order]
    return selected, current_scores[selected]


def evaluate_potential(queries: list[dict[str, Any]], catalogs: dict[str, dict[str, Any]], fits: dict[str, dict[str, dict[str, Any]]], strategy: str, config: dict[str, Any], output: Path) -> dict[str, Any]:
    result_path = output / "potential-rankings.jsonl"
    coverage = defaultdict(lambda: defaultdict(Counter))
    count = 0
    with result_path.open("w") as stream:
        for query in queries:
            position = query["position"]
            catalog = catalogs[position]
            reference, mean_ca = query_vector(query, catalog)
            current_scores = distances(strategy, reference, catalog["matrix"], fits[position][strategy])
            for scenario in config["potentialScenarios"]:
                pool = scenario_pool(catalog, scenario, query["referenceIds"])
                selected, distances_to_reference = potential_order(catalog, pool, current_scores, config["topK"])
                pa_values = catalog["pa"][selected]
                if len(pa_values) > 1 and np.any(pa_values[:-1] < pa_values[1:]):
                    raise AssertionError("Potential list is not PA-descending")
                row = {
                    "split": query["split"],
                    "position": position,
                    "queryKey": query["queryKey"],
                    "queryKind": query["kind"],
                    "referenceIds": query["referenceIds"],
                    "scenario": scenario["id"],
                    "poolSize": len(pool),
                    "strategy": "potential_pa_desc_current_distance_tiebreak",
                    "topIds": catalog["ids"][selected].tolist(),
                    "topPa": pa_values.astype(int).tolist(),
                    "currentAttributeDistances": distances_to_reference.tolist(),
                    "topCa": catalog["ca"][selected].tolist(),
                    "topAges": catalog["ages"][selected].tolist(),
                    "meanReferenceCa": mean_ca,
                }
                stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
                coverage[position][scenario["id"]]["queries"] += 1
                coverage[position][scenario["id"]]["emptyPools"] += int(len(pool) == 0)
                coverage[position][scenario["id"]]["profilesWithCaBelow160"] += int(np.sum(catalog["ca"][selected] < 160))
                count += 1
    return {"rows": count, "coverage": {position: {scenario: dict(counter) for scenario, counter in scenarios.items()} for position, scenarios in coverage.items()}, "sort": "PA descending; current attribute distance ascending; FM ID ascending"}


def evaluate_ablations(queries: list[dict[str, Any]], catalogs: dict[str, dict[str, Any]], fits: dict[str, dict[str, dict[str, Any]]], fit_ids: set[str], selected_strategy: str, config: dict[str, Any], output: Path) -> dict[str, Any]:
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for position, catalog in catalogs.items():
        grouped[position] = {}
        for family in dict.fromkeys(["mae", selected_strategy]):
            grouped[position][family] = {}
            for removed_group in catalog["groups"]:
                remaining_groups = {name: names for name, names in catalog["groups"].items() if name != removed_group}
                removed_features = set(catalog["groups"][removed_group])
                keep_indices = np.asarray([index for index, feature in enumerate(catalog["features"]) if feature not in removed_features], dtype=np.int64)
                feature_names = [catalog["features"][int(index)] for index in keep_indices]
                fit_mask = np.isin(catalog["ids"], list(fit_ids))
                reduced_fit = catalog["matrix"][fit_mask][:, keep_indices]
                fit_parameters = fit_strategy(family, reduced_fit, remaining_groups, feature_names)
                grouped[position][family][removed_group] = {"indices": keep_indices, "features": feature_names, "groups": remaining_groups, "fit": fit_parameters}
    rows = []
    for query in queries:
        position = query["position"]
        catalog = catalogs[position]
        reference, mean_ca = query_vector(query, catalog)
        pool = scenario_pool(catalog, config["currentScenarios"][0], query["referenceIds"])
        baseline_strategies = list(grouped[position])
        for family in baseline_strategies:
            base_scores = distances(family, reference, catalog["matrix"], fits[position][family])
            base_top, _ = rank(base_scores, pool, catalog["ids"], 5)
            base_gap = float(np.mean(np.abs(catalog["ca"][base_top] - mean_ca))) if len(base_top) else None
            for group_name, ablation in grouped[position][family].items():
                reduced_query = reference[ablation["indices"]]
                reduced_matrix = catalog["matrix"][:, ablation["indices"]]
                reduced_scores = distances(family, reduced_query, reduced_matrix, ablation["fit"])
                reduced_top, _ = rank(reduced_scores, pool, catalog["ids"], 5)
                gap = float(np.mean(np.abs(catalog["ca"][reduced_top] - mean_ca))) if len(reduced_top) else None
                rows.append({
                    "position": position,
                    "queryKey": query["queryKey"],
                    "queryKind": query["kind"],
                    "parentStrategy": family,
                    "removedGroup": group_name,
                    "removedFeatures": catalog["groups"][group_name],
                    "remainingFeatureCount": len(ablation["features"]),
                    "top5JaccardAgainstParent": jaccard(base_top, reduced_top, 5),
                    "parentMeanCaGap5": base_gap,
                    "ablatedMeanCaGap5": gap,
                    "caGapDelta": None if gap is None or base_gap is None else gap - base_gap,
                    "ablatedTopIds": catalog["ids"][reduced_top].tolist(),
                })
    write_json(output / "feature-ablations-test.json", rows)
    summary = defaultdict(lambda: defaultdict(list))
    for row in rows:
        key = f"{row['position']}/{row['parentStrategy']}/{row['removedGroup']}"
        summary[key]["jaccard"].append(row["top5JaccardAgainstParent"])
        if row["caGapDelta"] is not None:
            summary[key]["caGapDelta"].append(row["caGapDelta"])
    summaries = {
        key: {"queries": len(value["jaccard"]), "meanTop5JaccardAgainstParent": float(np.mean(value["jaccard"])),
              "meanCaGapDelta": float(np.mean(value["caGapDelta"])) if value["caGapDelta"] else None}
        for key, value in summary.items()
    }
    return {"rows": len(rows), "summary": summaries}


def save_catalog(output: Path, catalogs: dict[str, dict[str, Any]]) -> None:
    arrays = {}
    for position, catalog in catalogs.items():
        arrays[f"ids__{position}"] = catalog["ids"]
        arrays[f"matrix__{position}"] = catalog["matrix"]
        arrays[f"ages__{position}"] = catalog["ages"]
        arrays[f"ca__{position}"] = catalog["ca"]
        arrays[f"pa__{position}"] = catalog["pa"]
        arrays[f"ratings__{position}"] = catalog["ratings"]
        arrays[f"names__{position}"] = catalog["names"]
    np.savez_compressed(output / "catalog.npz", **arrays)


def aggregate_noise(noise_rows: list[dict[str, Any]]) -> dict[str, Any]:
    result = {}
    for strategy in sorted({row["strategy"] for row in noise_rows}):
        mean, per_position = macro_values(noise_rows, "j5_pm2", strategy)
        mean_pm1, per_position_pm1 = macro_values(noise_rows, "j5_pm1", strategy)
        result[strategy] = {"macroJ5pm1": mean_pm1, "perPositionJ5pm1": per_position_pm1, "macroJ5pm2": mean, "perPositionJ5pm2": per_position}
    return result


def potential_fixture_check() -> dict[str, Any]:
    ids = np.array(["low-current-high-pa", "higher-current-lower-pa", "same-pa-closer", "same-pa-farther"])
    pa = np.array([190, 170, 180, 180])
    current = np.array([5.0, 1.0, 0.2, 3.0])
    order = np.lexsort((ids, current, -pa))
    ranked = ids[order].tolist()
    expected = ["low-current-high-pa", "same-pa-closer", "same-pa-farther", "higher-current-lower-pa"]
    if ranked != expected:
        raise AssertionError(f"Potential ranking fixture failed: {ranked}")
    return {"passed": True, "orderedIds": ranked, "lowCurrentHighPaSurfaces": ranked[0] == "low-current-high-pa"}


def render_report(summary: dict[str, Any], output: Path) -> str:
    lines = [
        "# 全位置 FM 属性相似公式与消融实验报告", "", "Status: resolved", "Labels: ready-for-agent", "",
        f"运行时间：{summary['createdAt']}。协议：`{summary['config']['protocolVersion']}`。", "",
        f"结论状态：**{summary['selection']['status']}**。全局公式：`{summary['selection']['defaultStrategy']}`；开发候选：`{summary['selection']['developmentSelected']}`。该结果只代表本快照、冻结的位置属性映射和预注册工程稳健性协议，不是现实足球相关性标签。", "",
        "## 数据和覆盖", "",
        f"FM manifest：`{summary['data']['manifestSha256']}`；快照日期 `{summary['data']['snapshotDate']}`；有效 FM IDs {summary['data']['uniqueProfiles']:,}。Feature-map SHA256：`{summary['data']['featureMapSha256']}`。", "",
        "| 位置 | 候选评分≥15 | feature数 | 拟合 | 开发 query | 测试 query |", "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for position in sorted(summary["data"]["positions"]):
        item = summary["data"]["positions"][position]
        split = summary["queryCounts"][position]
        lines.append(f"| {position} | {item['ratingAtLeast15']} | {item['featureCount']} | {item['fitRows']} | {split['development']} | {split['test']} |")
    lines.extend(["", "`SW` 没有 rating≥15 候选，未纳入覆盖和宏平均。每个位置查询集合在 14 个位置间身份不重叠；不同集合的 FM IDs 也完全隔离。", "", "## 全局公式对比", "",
                  "全局宏平均对所有具体位置等权。J5±2 是参考画像在固定 ±2 raw 属性扰动后的 Top5 Jaccard 稳定性；它是工程诊断，不是真实推荐质量。", "",
        "| 公式 | 开发 J5±2 | 测试 J5±2 | 开发相对 MAE Δ（95% CI） | 测试相对 MAE Δ（95% CI） | 测试最差位置 Δ | p95 ms | 可晋级 |",
        "| --- | ---: | ---: | --- | --- | ---: | ---: | --- |"])
    dev_noise = summary["development"]["noise"]
    test_noise = summary["test"]["noise"]
    for strategy in summary["config"]["mainStrategies"] + summary["config"]["controls"]:
        dev_score = dev_noise[strategy]["macroJ5pm2"]
        test_score = test_noise[strategy]["macroJ5pm2"]
        dev_cmp = next((row for row in summary["selection"]["developmentComparisons"] if row["strategy"] == strategy), None)
        test_cmp = next((row for row in summary["selection"]["testComparisons"] if row["strategy"] == strategy), None)
        if dev_cmp is None or test_cmp is None:
            ci_dev = ci_test = "—"
            min_pos = "—"
            passes = "否（对照/不参选）"
        else:
            d, t = dev_cmp["jaccardDelta"], test_cmp["jaccardDelta"]
            ci_dev = f"{d['mean']:.3f} [{d['low95']:.3f}, {d['high95']:.3f}]"
            ci_test = f"{t['mean']:.3f} [{t['low95']:.3f}, {t['high95']:.3f}]"
            min_pos = f"{test_cmp['minimumPositionDelta']:.3f}"
            passes = "是" if test_cmp["passes"] else "否"
        lines.append(f"| {strategy} | {dev_score:.3f} | {test_score:.3f} | {ci_dev} | {ci_test} | {min_pos} | {summary['timing'].get(strategy, {}).get('p95Milliseconds', float('nan')):.2f} | {passes} |")
    lines.extend(["", "| 场景 | 最小池 | 空池 query | 少于5人 query |", "| --- | ---: | ---: | ---: |"])
    for position in sorted(summary["catalogCoverage"]):
        for scenario, values in summary["catalogCoverage"][position].items():
            lines.append(f"| {position}/{scenario} | {values['minimumPool']} | {values['emptyPools']} | {values['poolsBelow5']} |")
    lines.extend(["", "## 属性组消融", "", "对 MAE 与开发阶段选出的全局公式，分别去掉每个位置属性组；候选资格不变。Jaccard=1 表示去组前后 Top5 相同。结果解释属性组对该冻结排序的影响，不作为因果或足球实战标签。", "",
                  "| 位置/公式/移除组 | Top5 与完整模型平均 Jaccard | 平均 CA gap 变化 |", "| --- | ---: | ---: |"])
    for key, values in sorted(summary["ablations"]["summary"].items()):
        gap = "—" if values["meanCaGapDelta"] is None else f"{values['meanCaGapDelta']:.2f}"
        lines.append(f"| {key} | {values['meanTop5JaccardAgainstParent']:.3f} | {gap} |")
    lines.extend(["", "## 高潜名单", "", "高潜名单通过确定性 PA 排序检查：先 PA 降序，再当前属性距离升序，最后稳定 FM ID。PA 不与当前属性距离合成。", "",
                  "| 位置 | 场景 | query数 | 空池 | TopK 中 CA<160 的累计数 |", "| --- | --- | ---: | ---: | ---: |"])
    for position in sorted(summary["potential"]["coverage"]):
        for scenario, values in summary["potential"]["coverage"][position].items():
            lines.append(f"| {position} | {scenario} | {values['queries']} | {values['emptyPools']} | {values['profilesWithCaBelow160']} |")
    lines.extend(["", "这些 CA/PA 数字和属性相似度都来自 FM 快照；潜力名单不预测实际发展，不代表候选会达到 PA。", "", "## 结论限制", "",
                  "- 公式赢家只对这批 FM 快照、位置特征映射、查询采样和属性噪声协议成立。",
                  "- 没有独立球探相关性标签，因此不报告 NDCG/Recall，也不称为真实替代质量最优。",
                  "- STC-only 的 `rmse18` 作为历史对照保留；全局结果由本次 14 位置宏平均实验决定。",
                  "- 实验不调用网关、LLM、Understat 或其他外部服务。", "",
                  f"原始排名、split、拟合参数、噪声结果和逐项验证保存在 `{output.relative_to(ROOT)}`。", ""])
    return "\n".join(lines)


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    config_bytes = CONFIG_PATH.read_bytes()
    feature_map_path = ROOT / config["featureMapPath"]
    feature_map_bytes = feature_map_path.read_bytes()
    if sha_bytes(feature_map_bytes) != config["expectedFeatureMapSha256"]:
        raise ValueError("Position feature map changed after preregistration; update config and freeze a new protocol")
    feature_map = json.loads(feature_map_bytes)
    positions = validate_feature_map(feature_map)
    numeric = numeric_checks()
    if not numeric["passed"]:
        raise AssertionError("Distance numeric checks failed")
    potential_check = potential_fixture_check()
    if not potential_check["passed"]:
        raise AssertionError("Potential ranking fixture failed")
    output = ROOT / ".data/recommendation-experiments" / config["runId"]
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite experiment output: {output}")
    started = time.perf_counter()
    log(f"Numerical checks passed ({numeric['checkCount']}); reading FM snapshot")
    dataset, data_info = load_dataset(config, feature_map)
    catalogs, data = dataset["catalogs"], dataset["profileData"]
    split_sets = split_identities(data["ids"], config)
    queries = create_queries(catalogs, split_sets, config)
    all_queries = queries["development"] + queries["test"]
    expected_query_count = len(positions) * (config["singleQueriesPerPositionPerSplit"] + config["twoReferenceQueriesPerPositionPerSplit"] + config["threeReferenceQueriesPerPositionPerSplit"])
    if len(queries["development"]) != expected_query_count or len(queries["test"]) != expected_query_count:
        raise AssertionError("Unexpected per-position query count")
    # Query identities are disjoint across positions within each split by construction.
    for split_name in ("development", "test"):
        used = [identity for query in queries[split_name] for identity in query["referenceIds"]]
        if len(used) != len(set(used)):
            raise AssertionError("Reference groups overlap across queries in the same split")
    fit_ids = split_sets["fit"]
    fits, fit_summary = build_fit_parameters(catalogs, fit_ids)
    for position in catalogs:
        data_info["positions"][position]["fitRows"] = int(np.sum(np.isin(catalogs[position]["ids"], list(fit_ids))))
    output.mkdir(parents=True)
    save_catalog(output, catalogs)
    write_json(output / "queries.json", {"splits": {key: sorted(value) for key, value in split_sets.items()}, "queries": queries})
    write_json(output / "fitted-parameters.json", fit_summary)
    code_hashes = {path.name: sha_file(path) for path in (Path(__file__), HERE / "metrics.py")}
    lock = {
        "config": config,
        "configSha256": sha_bytes(config_bytes),
        "featureMapSha256": sha_bytes(feature_map_bytes),
        "featureMapVersion": feature_map["version"],
        "codeSha256": code_hashes,
        "manifest": dataset["manifest"],
        "data": data_info,
        "numericChecks": numeric,
        "potentialFixtureCheck": potential_check,
        "fitRowsByPosition": {pos: fit_summary[pos]["fitRows"] for pos in positions},
        "queryRowsPerPositionPerSplit": config["singleQueriesPerPositionPerSplit"] + config["twoReferenceQueriesPerPositionPerSplit"] + config["threeReferenceQueriesPerPositionPerSplit"],
        "identityIsolation": "global unique_id split; disjoint reference IDs across queries per split",
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    write_json(output / "protocol-lock.json", lock)
    log(f"Feature map frozen {lock['featureMapSha256']}; loaded {len(data['ids'])} profiles")
    log(f"Queries: {len(queries['development'])} dev + {len(queries['test'])} test; identities split {len(split_sets['fit'])}/{len(split_sets['development'])}/{len(split_sets['test'])}")
    log("Evaluating development rankings and perturbations")
    dev_noise, dev_gaps, dev_counts = evaluate_split("development", queries["development"], catalogs, fits, config, output)
    timing = timing_benchmark(queries["development"], catalogs, fits, config)
    dev_selection = choose_global(dev_noise, timing, config, "development")
    write_json(output / "dev-selection.json", dev_selection)
    log(f"Frozen global development choice: {dev_selection['selected']} ({dev_selection['status']}); evaluating test")
    test_noise, test_gaps, test_counts = evaluate_split("test", queries["test"], catalogs, fits, config, output)
    test_comparisons = []
    for strategy in config["selectionStrategies"]:
        delta = paired_macro_bootstrap(test_noise, "mae", strategy, "j5_pm2", config, f"test:{strategy}")
        _, per_position = macro_values(test_noise, "j5_pm2", strategy)
        per_position_delta = delta["positionMeans"]
        test_comparisons.append({
            "strategy": strategy,
            "jaccardDelta": delta,
            "macroJ5pm2": per_position,
            "minimumPositionDelta": min(per_position_delta.values()),
            "p95Milliseconds": timing[strategy]["p95Milliseconds"],
            "passes": bool(delta["mean"] >= config["minimumMacroJaccardGain"] and delta["low95"] > 0.0 and min(per_position_delta.values()) >= config["maximumPerPositionJaccardRegression"] and timing[strategy]["p95Milliseconds"] < config["maximumP95Milliseconds"]),
        })
    selected = dev_selection["selected"]
    selected_test = next(row for row in test_comparisons if row["strategy"] == selected) if selected != "mae" else None
    test_confirmed = bool(selected_test and selected_test["passes"])
    default_strategy = selected if test_confirmed else "mae"
    selection_status = "provisional" if test_confirmed else "inconclusive"
    selection = {
        "status": selection_status,
        "defaultStrategy": default_strategy,
        "developmentSelected": selected,
        "testConfirmed": test_confirmed,
        "developmentComparisons": dev_selection["comparisons"],
        "testComparisons": test_comparisons,
        "selectionScope": "one formula globally; equal macro weight per populated exact FM position",
        "nonClaims": ["not validated against independent scout relevance labels", "not proof of real-world replacement quality"],
    }
    write_json(output / "selection-global.json", selection)
    log(f"Selected global default: {default_strategy} ({selection_status})")
    potential = evaluate_potential(all_queries, catalogs, fits, default_strategy, config, output)
    ablations = evaluate_ablations(queries["test"], catalogs, fits, fit_ids, default_strategy, config, output)
    write_json(output / "ablation-summary.json", ablations)
    catalog_coverage = {}
    for position, catalog in catalogs.items():
        catalog_coverage[position] = {}
        for scenario in config["currentScenarios"]:
            pools = [len(scenario_pool(catalog, scenario, query["referenceIds"])) for query in queries["test"] if query["position"] == position]
            catalog_coverage[position][scenario["id"]] = {"minimumPool": int(min(pools)), "emptyPools": int(sum(size == 0 for size in pools)), "poolsBelow5": int(sum(size < 5 for size in pools))}
    summary = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "config": config,
        "data": {**data_info, "manifestSha256": dataset["manifest"]["sha256"], "snapshotDate": dataset["manifest"]["inGameDate"], "featureMapSha256": lock["featureMapSha256"], "uniqueProfiles": len(data["ids"])},
        "queryCounts": {pos: {"development": sum(query["position"] == pos for query in queries["development"]), "test": sum(query["position"] == pos for query in queries["test"])} for pos in positions},
        "development": {"noise": aggregate_noise(dev_noise), "caGap5": {pos: {strategy: float(np.mean(values)) for strategy, values in dev_gaps[pos].items()} for pos in dev_gaps}, "rankingRows": dev_counts["rankingRows"]},
        "test": {"noise": aggregate_noise(test_noise), "caGap5": {pos: {strategy: float(np.mean(values)) for strategy, values in test_gaps[pos].items()} for pos in test_gaps}, "rankingRows": test_counts["rankingRows"]},
        "selection": selection,
        "timing": timing,
        "catalogCoverage": catalog_coverage,
        "potential": potential,
        "ablations": ablations,
        "numericChecks": numeric,
        "elapsedSeconds": time.perf_counter() - started,
        "peakRssMegabytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 2 if sys.platform == "darwin" else 1024),
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform(), "threads": {key: os.environ.get(key) for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "VECLIB_MAXIMUM_THREADS")}},
    }
    write_json(output / "summary.json", summary)
    report = render_report(summary, output)
    (ROOT / ".scratch/player-recommendation/multi-position-report.md").write_text(report)
    log(json.dumps({"status": "complete", "defaultStrategy": default_strategy, "selectionStatus": selection_status, "elapsedSeconds": summary["elapsedSeconds"], "output": str(output.relative_to(ROOT)), "report": ".scratch/player-recommendation/multi-position-report.md"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
