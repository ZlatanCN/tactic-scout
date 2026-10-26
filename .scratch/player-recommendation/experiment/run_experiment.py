"""Offline numerical experiment; source SQLite files are opened read-only.

Run with a Python environment containing NumPy. Dataset/ranking artifacts are
written under ignored .data/recommendation-experiments/, never to graph state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import resource
import sqlite3
import sys
import time
import unicodedata
import zlib
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from metrics import build_metrics, run_numeric_checks


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
CONTROLS = ("ca_only", "random")


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def stable_seed(seed, *parts):
    text = ":".join(str(part) for part in (seed, *parts))
    return int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "big")


def json_default(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Path):
        return str(value)
    raise TypeError(type(value).__name__)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2,
                               default=json_default, allow_nan=False) + "\n")


def progress(message):
    print(message, flush=True)


def connect(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return closing(connection)


def numeric(value):
    if value is None or value == "":
        raise ValueError("missing numeric value")
    number = float(value)
    if not np.isfinite(number):
        raise ValueError("nonfinite numeric value")
    return number


def age_on(birth, as_of):
    return as_of.year - birth.year - ((as_of.month, as_of.day) < (birth.month, birth.day))


def load_catalog(config):
    started = time.perf_counter()
    path = ROOT / ".data/fm/profiles-v2.sqlite"
    records, excluded = [], Counter()
    with connect(path) as connection:
        manifest = json.loads(connection.execute("SELECT payload FROM manifest WHERE id=1").fetchone()[0])
        if manifest["sha256"] != config["expectedManifestSha256"]:
            raise ValueError("FM manifest changed: freeze a new protocol before running")
        as_of = date.fromisoformat(manifest["inGameDate"])
        rows = connection.execute(
            "SELECT p.record_id,p.unique_id,p.name,p.birth_date,p.payload,s.position,s.rating "
            "FROM players p JOIN positions s ON p.record_id=s.record_id "
            "WHERE s.position='stc' AND s.rating=20 ORDER BY p.unique_id,p.record_id"
        ).fetchall()
        for row in rows:
            assert row["position"] == "stc" and row["rating"] == 20
            if row["unique_id"] in (None, ""):
                excluded["missing_fm_id"] += 1
                continue
            profile = json.loads(zlib.decompress(row["payload"], -15))
            try:
                vector = [numeric(profile["raw_attributes_" + key]) for key in config["features"]]
                ca = numeric(profile["ability_current"])
                birth = date.fromisoformat(profile["birth_date"])
                if any(value < 1 or value > 100 for value in vector) or not 1 <= ca <= 200:
                    raise ValueError("attribute outside declared scale")
                if np.linalg.norm(np.array(vector) - np.mean(vector)) <= 1e-12:
                    excluded["constant_profile_common_domain"] += 1
                    continue
                if np.linalg.norm(np.array(vector[:10]) - np.mean(vector[:10])) <= 1e-12:
                    excluded["constant_first10_common_domain"] += 1
                    continue
                records.append({
                    "id": str(row["unique_id"]), "recordId": row["record_id"],
                    "name": profile.get("common_name") or profile.get("full_name") or row["name"],
                    "ca": ca, "age": age_on(birth, as_of), "vector": vector,
                })
            except (ValueError, KeyError, TypeError):
                excluded["invalid_required_fields"] += 1
    ids = [record["id"] for record in records]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate stable FM IDs in corpus")
    return records, manifest, {
        "naturalStcRows": len(rows), "eligibleRows": len(records), "excluded": dict(excluded),
        "readDecodeMilliseconds": (time.perf_counter() - started) * 1000,
        "sqliteSha256": digest_file(path), "sqliteBytes": path.stat().st_size,
    }


def stratum(record):
    ca = record["ca"]
    ability = "ca_lt80" if ca < 80 else "ca80_119" if ca < 120 else "ca120_159" if ca < 160 else "ca160_plus"
    age = record["age"]
    age_band = "age_le20" if age <= 20 else "age21_25" if age <= 25 else "age26_30" if age <= 30 else "age31_plus"
    return ability + "/" + age_band


def split_queries(records, config):
    rng = np.random.default_rng(config["seed"])
    strata = defaultdict(list)
    for index, record in enumerate(records):
        strata[stratum(record)].append(index)
    queues = {key: list(rng.permutation(indices)) for key, indices in sorted(strata.items())}
    sampled = []
    while len(sampled) < config["queryCount"]:
        changed = False
        for indices in queues.values():
            if indices and len(sampled) < config["queryCount"]:
                sampled.append(int(indices.pop()))
                changed = True
        if not changed:
            raise ValueError("not enough unique query identities")
    sampled = list(rng.permutation(sampled))
    development = np.array(sampled[:config["developmentCount"]], dtype=int)
    test = np.array(sampled[config["developmentCount"]:], dtype=int)
    fit = np.array(sorted(set(range(len(records))) - set(sampled)), dtype=int)
    assert not set(fit) & set(development) and not set(test) & set(development)
    return fit, development, test


def rank(scores, pool, ids, k=10):
    if not np.all(np.isfinite(scores)):
        raise ValueError("nonfinite score on frozen common corpus")
    order = np.lexsort((ids[pool], scores))[:min(k, len(pool))]
    return pool[order], np.asarray(scores)[order]


def overlap(left, right, k):
    a, b = set(left[:k]), set(right[:k])
    return len(a & b) / len(a | b) if a or b else 1.0


def make_pools(query_index, records, ca, ages, config):
    pools = {}
    for scenario in config["scenarios"]:
        mask = np.ones(len(records), dtype=bool)
        mask[query_index] = False
        if scenario["maxAge"] is not None:
            mask &= ages <= scenario["maxAge"]
        if scenario["minCa"] is not None:
            mask &= ca >= scenario["minCa"]
        pools[scenario["id"]] = np.flatnonzero(mask)
    return pools


def score_strategy(strategy, query_index, query, pool, metrics, ca, config):
    if strategy == "ca_only":
        return np.abs(ca[pool] - ca[query_index])
    if strategy == "random":
        rng = np.random.default_rng(stable_seed(config["seed"], "random", query_index))
        return rng.random(len(ca))[pool]
    return metrics[strategy].distances(query, pool)


def evaluate_split(split, queries, records, matrix, ids, metrics, ca, ages, config, output):
    rows, noise_rows = [], []
    strategy_ids = list(metrics) + list(CONTROLS)
    gates = Counter()
    noise_seed = config["seed"]
    with (output / f"rankings-{split}.jsonl").open("w") as stream:
        for ordinal, query_index in enumerate(queries):
            query_index = int(query_index)
            reference = matrix[query_index]
            pools = make_pools(query_index, records, ca, ages, config)
            base_open = {}
            for scenario in config["scenarios"]:
                pool = pools[scenario["id"]]
                for strategy in strategy_ids:
                    scores = score_strategy(strategy, query_index, reference, pool, metrics, ca, config)
                    top, top_scores = rank(scores, pool, ids)
                    assert query_index not in top and len(top) == len(set(top))
                    assert set(top).issubset(set(pool))
                    if scenario["maxAge"] is not None:
                        assert np.all(ages[top] <= scenario["maxAge"])
                    if scenario["minCa"] is not None:
                        assert np.all(ca[top] >= scenario["minCa"])
                    gates["ranking_checks"] += 1
                    row = {
                        "split": split, "queryId": records[query_index]["id"],
                        "queryCa": ca[query_index], "queryAge": ages[query_index],
                        "stratum": stratum(records[query_index]), "scenario": scenario["id"],
                        "poolSize": len(pool), "strategy": strategy,
                        "topIds": ids[top].tolist(), "topScores": top_scores.tolist(),
                        "meanCaGap5": float(np.abs(ca[top[:5]] - ca[query_index]).mean()) if len(top) else None,
                        "meanAttributeShortfall5": float(np.maximum(reference - matrix[top[:5]], 0).mean()) if len(top) else None,
                    }
                    stream.write(json.dumps(row, default=json_default, allow_nan=False) + "\n")
                    rows.append(row)
                    if scenario["id"] == "open":
                        base_open[strategy] = top
            noise_records = {strategy: defaultdict(list) for strategy in strategy_ids}
            perturbations = []
            for amount in (1, 2):
                for replica in range(config["noiseReplicates"]):
                    rng = np.random.default_rng(stable_seed(noise_seed, records[query_index]["id"], amount, replica))
                    perturbations.append((f"pm{amount}", np.clip(reference + rng.integers(-amount, amount + 1, len(reference)), 1, 100)))
            for group, feature_names in config["groups"].items():
                changed = reference.copy()
                indices = [config["features"].index(name) for name in feature_names]
                rng = np.random.default_rng(stable_seed(noise_seed, records[query_index]["id"], group))
                changed[indices] = np.clip(changed[indices] + rng.choice((-2, 2)), 1, 100)
                perturbations.append(("group", changed))
            for label, changed in perturbations:
                for strategy in strategy_ids:
                    pool = pools["open"]
                    scores = score_strategy(strategy, query_index, changed, pool, metrics, ca, config)
                    top, _ = rank(scores, pool, ids)
                    noise_records[strategy][f"jaccard5_{label}"].append(overlap(base_open[strategy], top, 5))
                    noise_records[strategy][f"jaccard10_{label}"].append(overlap(base_open[strategy], top, 10))
            for strategy in strategy_ids:
                noise_rows.append({
                    "queryId": records[query_index]["id"], "strategy": strategy,
                    "poolSize": len(pools["open"]),
                    **{key: float(np.mean(values)) for key, values in noise_records[strategy].items()},
                })
            if (ordinal + 1) % 20 == 0:
                progress(f"{split}: {ordinal + 1}/{len(queries)} identities")
    write_json(output / f"noise-{split}.json", noise_rows)
    return rows, noise_rows, dict(gates)


def paired_delta(rows, baseline, challenger, field, config, salt):
    base = {row["queryId"]: row[field] for row in rows if row["strategy"] == baseline and row.get(field) is not None}
    other = {row["queryId"]: row[field] for row in rows if row["strategy"] == challenger and row.get(field) is not None}
    shared = sorted(set(base) & set(other))
    if not shared:
        return {"mean": None, "low95": None, "high95": None, "n": 0}
    differences = np.array([other[key] - base[key] for key in shared])
    rng = np.random.default_rng(stable_seed(config["seed"], "paired-bootstrap", salt))
    indices = rng.integers(0, len(shared), (config["bootstrapReplicates"], len(shared)))
    samples = differences[indices].mean(axis=1)
    return {"mean": float(differences.mean()), "low95": float(np.quantile(samples, .025)),
            "high95": float(np.quantile(samples, .975)), "n": len(shared)}


def aggregate(rows, noise_rows, strategies):
    output = {}
    for strategy in strategies:
        selected = [row for row in rows if row["strategy"] == strategy]
        noisy = [row for row in noise_rows if row["strategy"] == strategy]
        scenario_stats = {}
        for scenario in sorted({row["scenario"] for row in selected}):
            subset = [row for row in selected if row["scenario"] == scenario]
            gaps = [row["meanCaGap5"] for row in subset if row["meanCaGap5"] is not None]
            scenario_stats[scenario] = {
                "queries": len(subset), "emptyPools": sum(row["poolSize"] == 0 for row in subset),
                "poolsBelowK": sum(row["poolSize"] < 5 for row in subset),
                "minimumPool": min((row["poolSize"] for row in subset), default=0),
                "meanCaGap5": float(np.mean(gaps)) if gaps else None,
                "meanShortfall5": float(np.mean([row["meanAttributeShortfall5"] for row in subset if row["meanAttributeShortfall5"] is not None])) if gaps else None,
                "uniqueTop5Lists": len({tuple(row["topIds"][:5]) for row in subset}),
            }
        noise_stats = {key: float(np.mean([row[key] for row in noisy])) for key in noisy[0] if key.startswith("jaccard")} if noisy else {}
        ca_strata = {}
        for ability in ("ca_lt80", "ca80_119", "ca120_159", "ca160_plus"):
            subset = [row for row in selected if row["scenario"] == "open" and row["stratum"].startswith(ability)]
            ca_strata[ability] = {"n": len(subset), "meanCaGap5": float(np.mean([row["meanCaGap5"] for row in subset])) if subset else None}
        output[strategy] = {"scenarios": scenario_stats, "noise": noise_stats, "caStrata": ca_strata}
    return output


def benchmark(queries, records, matrix, ids, metrics, ca, config):
    rng = np.random.default_rng(stable_seed(config["seed"], "benchmark"))
    selected = list(queries[:config["benchmarkQueries"]])
    samples = defaultdict(list)
    first = {}
    strategies = list(metrics) + list(CONTROLS)
    for repeat in range(config["benchmarkRepeats"]):
        for strategy in rng.permutation(strategies):
            for query_index in selected:
                pool = np.delete(np.arange(len(records)), query_index)
                start = time.perf_counter_ns()
                scores = score_strategy(strategy, query_index, matrix[query_index], pool, metrics, ca, config)
                rank(scores, pool, ids)
                elapsed = (time.perf_counter_ns() - start) / 1_000_000
                first.setdefault(str(strategy), elapsed)
                samples[str(strategy)].append(elapsed)
    return {key: {"firstMeasuredMilliseconds": first[key], "p50Milliseconds": float(np.median(values)),
                  "p95Milliseconds": float(np.quantile(values, .95)), "measurements": len(values)}
            for key, values in samples.items()}


def choose_challenger(rows, noise_rows, summary, timing, metrics, config, split):
    eligible_noise = [row for row in noise_rows if row["poolSize"] >= config["minimumSelectionPool"]]
    open_rows = [row for row in rows if row["scenario"] == "open" and row["poolSize"] >= config["minimumSelectionPool"]]
    records, passing = [], []
    for strategy in config["selectionStrategies"]:
        noise = paired_delta(eligible_noise, "mae18", strategy, "jaccard5_pm2", config, split + ":noise")
        ability = paired_delta(open_rows, "mae18", strategy, "meanCaGap5", config, split + ":ca")
        distinct = summary[strategy]["scenarios"]["open"]["uniqueTop5Lists"]
        checks = {
            "levelSensitive": bool(metrics[strategy].level_sensitive),
            "nondegenerate": distinct >= min(20, noise["n"]),
            "minimumEffect": noise["mean"] is not None and noise["mean"] >= config["minimumJaccardGain"],
            "positivePairedInterval": noise["low95"] is not None and noise["low95"] > 0,
            "abilityGapGuardrail": ability["mean"] is not None and ability["mean"] <= config["maximumCaGapIncrease"],
            "latencyBudget": timing[strategy]["p95Milliseconds"] < config["maximumP95Milliseconds"],
        }
        entry = {"strategy": strategy, "jaccardDelta": noise, "caGapDelta": ability, "checks": checks, "passes": all(checks.values())}
        records.append(entry)
        if entry["passes"]:
            passing.append(entry)
    simplicity = {"rmse18": 0, "weighted_mae18": 1, "zrmse18": 2, "mahalanobis18": 3}
    passing.sort(key=lambda entry: (-entry["jaccardDelta"]["mean"], simplicity[entry["strategy"]]))
    return {"selected": passing[0]["strategy"] if passing else "mae18", "comparisons": records}


def normalized_name(value):
    return "".join(char for char in unicodedata.normalize("NFKD", value).casefold() if char.isalnum())


def example_cases(records, matrix, ids, metrics, ca, ages, config):
    result = []
    targets = ("Harry Kane", "Kylian Mbappe", "Erling Haaland", "Troy Parrott")
    for name in targets:
        matches = [i for i, record in enumerate(records) if normalized_name(record["name"]) == normalized_name(name)]
        if len(matches) != 1:
            result.append({"reference": name, "status": "not_uniquely_present", "matches": len(matches)})
            continue
        index = matches[0]
        pool = make_pools(index, records, ca, ages, config)["open"]
        rankings = {}
        for strategy in config["mainStrategies"]:
            top, scores = rank(metrics[strategy].distances(matrix[index], pool), pool, ids, 5)
            rankings[strategy] = [{"name": records[i]["name"], "id": records[i]["id"], "ca": ca[i],
                                   "age": ages[i], "distance": float(score)} for i, score in zip(top, scores)]
        result.append({"reference": records[index]["name"], "referenceId": records[index]["id"], "ca": ca[index], "rankings": rankings})
    return result


def understat_panel(records, matrix, ids, metrics, ca, config):
    fm_lookup = {record["id"]: i for i, record in enumerate(records)}
    bridges = {"fm": defaultdict(set), "understat": defaultdict(set)}
    with connect(ROOT / ".data/reep/identity-with-fm.sqlite") as registry:
        for row in registry.execute("SELECT provider,external_id,canonical_reep_id FROM bridges WHERE namespace='player' AND redirect_status='resolved' AND provider IN ('fm','understat')"):
            bridges[row["provider"]][str(row["external_id"])].add(str(row["canonical_reep_id"]))
    by_canonical = {}
    for fm_id, values in bridges["fm"].items():
        if len(values) == 1 and fm_id in fm_lookup:
            canonical = next(iter(values))
            if canonical in by_canonical and by_canonical[canonical] != fm_lookup[fm_id]:
                raise ValueError("Ambiguous current FM identity in auxiliary panel")
            by_canonical[canonical] = fm_lookup[fm_id]
    leagues, coverage = [], Counter()
    fields = ("npxG", "xA", "shots", "key_passes")
    unique_counts = {threshold: set() for threshold in (0, 90, 450, 900)}
    with connect(ROOT / ".data/understat/understat.sqlite") as database:
        for row in database.execute("SELECT resource_id,season_start_year,payload_json FROM source_snapshots WHERE kind='league'"):
            eligible = []
            for player in json.loads(row["payload_json"]).get("players", []):
                links = bridges["understat"].get(str(player["id"]), set())
                index = by_canonical.get(next(iter(links))) if len(links) == 1 else None
                if index is None:
                    continue
                minutes = numeric(player["time"])
                values = np.array([numeric(player[field]) for field in fields])
                for threshold, seen in unique_counts.items():
                    if minutes >= threshold:
                        seen.add(records[index]["id"])
                if minutes >= 450:
                    eligible.append((index, values * 90 / minutes))
            leagues.append((row["resource_id"], row["season_start_year"], eligible))
    observations = []
    for league, year, players in leagues:
        coverage[league] = len(players)
        if len(players) < 6:
            continue
        indices = np.array([item[0] for item in players])
        performance = {index: vector for index, vector in players}
        for index, reference in players:
            pool = indices[indices != index]
            for strategy in config["mainStrategies"] + list(CONTROLS):
                scores = score_strategy(strategy, index, matrix[index], pool, metrics, ca, config)
                top, _ = rank(scores, pool, ids, 5)
                gaps = np.array([np.abs(performance[int(candidate)] - reference) for candidate in top]).mean(axis=0)
                observations.append({"queryId": records[index]["id"], "league": league, "year": year, "strategy": strategy,
                                     **{field + "GapPer90": float(value) for field, value in zip(fields, gaps)}})
    aggregate_rows = {}
    for strategy in config["mainStrategies"] + list(CONTROLS):
        selected = [row for row in observations if row["strategy"] == strategy]
        aggregate_rows[strategy] = {"leagueQueryObservations": len(selected), "uniqueQueryPlayers": len({row["queryId"] for row in selected}),
                                    **{field + "GapPer90": float(np.mean([row[field + "GapPer90"] for row in selected])) if selected else None for field in fields}}
    return {"purpose": "exploratory_diagnostic_not_quality_labels", "minimumMinutes": 450,
            "uniqueCoverageByMinutes": {str(key): len(value) for key, value in unique_counts.items()},
            "leagueCountsAt450": dict(coverage), "minimumPoolPlayers": 6,
            "aggregate": aggregate_rows, "observations": observations}


def fmt(value, digits=3):
    return "—" if value is None else f"{value:.{digits}f}"


def render_report(result, config, output):
    development, test = result["development"], result["test"]
    choice = result["selection"]
    lines = [
        "# 中锋推荐公式对比与消融：离线实验报告", "", "Status: resolved", "Labels: ready-for-agent", "",
        f"运行日期：{result['createdAt']}。协议：`{config['protocolVersion']}`。结果目录：`{output.relative_to(ROOT)}`。", "",
        f"结论状态：**provisional**。开发集预先选定 `{choice['developmentSelected']}`，测试集确认后默认保留 **`{choice['defaultStrategy']}`**。没有独立替代相关性标签，本报告不宣称真实球员替代质量最优。", "",
        "## 数据与实验隔离", "",
        f"- STC 且 `positions.rating=20` 的原始画像 {result['data']['naturalStcRows']:,} 条，共同有效实验域 {result['data']['eligibleRows']:,} 条；这里的数值过滤不等于全部自然位置；排除原因 `{json.dumps(result['data']['excluded'], ensure_ascii=False)}`。",
        f"- FM 画像日期 `{result['manifest']['inGameDate']}`；manifest SHA `{result['manifest']['sha256']}`。",
        f"- 拟合身份 {result['splits']['fitCount']:,}，开发身份 {result['splits']['developmentCount']}，测试身份 {result['splits']['testCount']}；身份交集为零。候选目录固定，查询自身逐次排除。",
        f"- 标准化和收缩协方差只用拟合身份；各查询的 3 个硬条件场景共享候选资格。{len(result['strategies'])} 个配置包含 7 个主公式、单因素消融和 2 个对照。",
        f"- 运行前配置 SHA `{result['configSha256']}`；数值检查 `{json.dumps(result['numericChecks'], ensure_ascii=False, default=json_default)}`。",
        "- 稳定性只用 open 场景、至少50名候选的查询选型。每个球员的扰动先合并，再按球员做2000次配对 bootstrap。",
        "- 开发选型写入 dev-selection.json 并冻结后才开始测试。测试中其他公式仅作描述性对比，不用于重新选赢家。", "",
        "## 七类公式与对照", "",
        "J5±2 是 Top5 在固定 ±2 点随机属性扰动下的 Jaccard，越高越稳定；CA 差为 open 场景 Top5 与参考的平均绝对 CA 差。两者均不是独立推荐相关性分数。", "",
        "| 配置 | 开发 J5±2 | 测试 J5±2 | 测试 CA 差 | 热查询 p95(ms) | 解释 |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for strategy in config["mainStrategies"] + list(CONTROLS):
        label = "风格方向，水平不敏感" if strategy in ("cosine18", "correlation18") else "负对照，不参与选型" if strategy in CONTROLS else "水平接近候选"
        lines.append(f"| {strategy} | {fmt(development[strategy]['noise']['jaccard5_pm2'])} | {fmt(test[strategy]['noise']['jaccard5_pm2'])} | {fmt(test[strategy]['scenarios']['open']['meanCaGap5'],2)} | {fmt(result['timing'][strategy]['p95Milliseconds'],2)} | {label} |")
    lines.extend(["", "随机和 CA-only 对属性扰动不敏感，因此可出现稳定性满分；这正是不能只按稳定性选择公式的对照。余弦类仍完整测量，按风格目标解释。", "", "## 预注册选择与测试确认", "",
                  "工程门槛：J5±2 相对 MAE 至少 +0.02 且95%区间下界>0；平均 CA 差增加不超过5；p95<50ms；评分水平敏感且名单非退化。这些是工程选择阈值，不是足球质量阈值。", "",
                  "| 测试比较（候选−MAE） | J5差值 | 95%区间 | CA差距变化 | 通过工程门槛 |", "| --- | ---: | --- | ---: | --- |"])
    for entry in choice["testComparisons"]:
        interval = entry["jaccardDelta"]
        lines.append(f"| {entry['strategy']} | {fmt(interval['mean'])} | [{fmt(interval['low95'])}, {fmt(interval['high95'])}] | {fmt(entry['caGapDelta']['mean'],2)} | {'是' if entry['passes'] else '否'} |")
    lines.extend(["", f"开发候选：`{choice['developmentSelected']}`；只对该候选执行晋级确认。最终工程默认：`{choice['defaultStrategy']}`。", "", "## 单因素消融", "",
                  "下表使用同一批测试身份，差值为变体减去父配置；仅作预注册消融描述，未根据测试结果重新组合默认策略。", "",
                  "| 变体 | 父配置 | J5±2变化（95%区间） | CA差变化 |", "| --- | --- | --- | ---: |"])
    for item in result["ablations"]:
        delta = item["jaccardDelta"]
        lines.append(f"| {item['variant']} | {item['parent']} | {fmt(delta['mean'])} [{fmt(delta['low95'])}, {fmt(delta['high95'])}] | {fmt(item['caGapDelta']['mean'],2)} |")
    lines.extend(["", "属性权重消融由 weighted_mae18 与 mae18 对比；权重按 physical/finishing/link 三组等总权重固定，各组内等权。10项变体保留原18项权重后取子集，避免同时改变两项因素。", "", "## 条件覆盖与运行成本", "",
                  f"正确性断言：`{json.dumps(result['gates'], ensure_ascii=False)}`；位置、年龄、CA、本人排除、重复ID、有限距离、重复排名和候选排列一致性均检查。", "",
                  "| 场景 | 测试查询数 | 最小候选池 | 空池 | 少于5人 | MAE CA差 |", "| --- | ---: | ---: | ---: | ---: | ---: |"])
    for scenario in config["scenarios"]:
        row = test["mae18"]["scenarios"][scenario["id"]]
        lines.append(f"| {scenario['id']} | {row['queries']} | {row['minimumPool']} | {row['emptyPools']} | {row['poolsBelowK']} | {fmt(row['meanCaGap5'],2)} |")
    lines.extend(["", f"共同读取解压 {result['data']['readDecodeMilliseconds']:.1f}ms；拟合和候选变换 {result['fitPrepareMilliseconds']:.1f}ms；整个实验 {result['elapsedSeconds']:.1f}s。进程峰值 RSS 约 {result['peakRssMegabytes']:.1f}MiB（共享进程，非单公式独占）。",
                  "热查询基准为已有画像矩阵上的算分+稳定Top10排序，排除 SQLite/模型耗时；首次测量也不等于操作系统无缓存冷启动。各公式不宜仅凭毫秒级差异宣称显著更快。", "", "## Understat 辅助切片", ""])
    panel = result["understat"]
    lines.extend([f"STC 且 `rating=20` 的画像关联覆盖：`{json.dumps(panel['uniqueCoverageByMinutes'])}`；至少450分钟的联赛记录：`{json.dumps(panel['leagueCountsAt450'])}`。只对同联赛且至少6人的小集合做Top5诊断。", "",
                  "| 配置 | 查询记录/唯一球员 | npxG/90差 | xA/90差 | 射门/90差 | 关键传球/90差 |", "| --- | ---: | ---: | ---: | ---: | ---: |"])
    for strategy in config["mainStrategies"]:
        row = panel["aggregate"][strategy]
        lines.append(f"| {strategy} | {row['leagueQueryObservations']}/{row['uniqueQueryPlayers']} | {fmt(row['npxGGapPer90'])} | {fmt(row['xAGapPer90'])} | {fmt(row['shotsGapPer90'])} | {fmt(row['key_passesGapPer90'])} |")
    lines.extend(["", "这些表现差只作探索性诊断：样本少、Top5几乎覆盖小候选池，且FM2025-11-23与比赛2026/27存在时点差。缺失资料没有作为负标签，此切片未参与默认选型。", "", "## 真实参考球员案例", ""])
    for case in result["cases"]:
        if "rankings" not in case:
            lines.append(f"- {case['reference']}：当前 STC 且 `rating=20` 实验域未唯一定位。")
            continue
        lines.extend([f"### {case['reference']}（CA {int(case['ca'])}）", "", "| 公式 | Top5（姓名／CA） |", "| --- | --- |"])
        for strategy, candidates in case["rankings"].items():
            values = "；".join(f"{p['name']}／{int(p['ca'])}" for p in candidates)
            lines.append(f"| {strategy} | {values} |")
        lines.append("")
    lines.extend(["## 复现与结论边界", "", "复现命令和环境见 experiment/README.md；原始排名、查询ID、拟合参数、配置锁和聚合保存在本次结果目录。summary.json包含完整分层指标与公式元数据。", "",
                  "本轮没有NDCG/Recall等真实相关性结果，因为没有独立替代标签。以MAE或其他参赛距离生成真值再比较会造成循环评测。工程默认属于可解释的暂定选择，未证明真实战术、转会或长期表现上的最佳替代效果。", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=".data/recommendation-experiments/20261025-v1")
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to((ROOT / ".data/recommendation-experiments").resolve()):
        raise ValueError("large experiment outputs must remain under ignored .data/recommendation-experiments")
    output.mkdir(parents=True, exist_ok=False)
    config_bytes = (HERE / "config.json").read_bytes()
    config = json.loads(config_bytes)
    code_hashes = {path.name: digest_file(path) for path in (Path(__file__), HERE / "metrics.py")}
    started = time.perf_counter()
    numeric_checks = run_numeric_checks()
    progress("Numerical checks passed; reading frozen natural-STC corpus")
    records, manifest, data = load_catalog(config)
    matrix = np.array([row["vector"] for row in records], dtype=np.float64)
    ids = np.array([row["id"] for row in records])
    ca = np.array([row["ca"] for row in records])
    ages = np.array([row["age"] for row in records])
    fit, development, test = split_queries(records, config)
    split_info = {"fitCount": len(fit), "developmentCount": len(development), "testCount": len(test),
                  "fitIds": ids[fit], "developmentIds": ids[development], "testIds": ids[test],
                  "developmentStrata": dict(Counter(stratum(records[i]) for i in development)),
                  "testStrata": dict(Counter(stratum(records[i]) for i in test))}
    write_json(output / "queries.json", split_info)
    np.savez_compressed(output / "catalog.npz", matrix=matrix, ids=ids, ca=ca, ages=ages)
    fit_started = time.perf_counter()
    metrics, fitted = build_metrics(matrix[fit], config["features"], config["groups"])
    level_probes = {}
    for metric in metrics.values():
        synthetic_reference = np.arange(40, 58, dtype=float)
        metric.prepare(np.vstack([synthetic_reference, synthetic_reference * .6]))
        probe = metric.distances(synthetic_reference, np.array([0, 1]))
        actual_sensitive = bool(probe[1] - probe[0] > 1e-6)
        assert actual_sensitive == metric.level_sensitive
        level_probes[metric.strategy_id] = {"identicalDistance": float(probe[0]), "scaledDownDistance": float(probe[1]), "levelSensitive": actual_sensitive}
        metric.prepare(matrix)
    fit_ms = (time.perf_counter() - fit_started) * 1000
    write_json(output / "fitted-parameters.json", fitted)
    strategies = {key: value.metadata() for key, value in metrics.items()}
    for control in CONTROLS:
        strategies[control] = {"family": "negative_control", "level_sensitive": False}
    auxiliary_hashes = {str(path.relative_to(ROOT)): digest_file(path) for path in (
        ROOT / ".data/reep/identity-with-fm.sqlite", ROOT / ".data/understat/understat.sqlite")}
    lock = {"config": config, "configSha256": digest_bytes(config_bytes), "codeSha256": code_hashes,
            "manifest": manifest, "data": data, "queryManifestSha256": digest_file(output / "queries.json"),
            "fittedParametersSha256": digest_file(output / "fitted-parameters.json"), "strategies": strategies,
            "auxiliaryDatabaseSha256": auxiliary_hashes, "levelSensitivityProbes": level_probes,
            "createdAt": datetime.now(timezone.utc).isoformat(), "numericChecks": numeric_checks}
    write_json(output / "protocol-lock.json", lock)
    progress(f"Frozen {len(records)} candidates; {len(fit)} fit/{len(development)} dev/{len(test)} test identities; {len(strategies)} arms")
    timing = benchmark(development, records, matrix, ids, metrics, ca, config)
    dev_rows, dev_noise, dev_gates = evaluate_split("development", development, records, matrix, ids, metrics, ca, ages, config, output)
    dev_summary = aggregate(dev_rows, dev_noise, strategies)
    dev_choice = choose_challenger(dev_rows, dev_noise, dev_summary, timing, metrics, config, "development")
    write_json(output / "dev-selection.json", dev_choice)
    frozen_selection_sha = digest_file(output / "dev-selection.json")
    progress(f"Development selection frozen: {dev_choice['selected']}; now evaluate test identities")
    test_rows, test_noise, test_gates = evaluate_split("test", test, records, matrix, ids, metrics, ca, ages, config, output)
    test_summary = aggregate(test_rows, test_noise, strategies)
    test_choice = choose_challenger(test_rows, test_noise, test_summary, timing, metrics, config, "test")
    selected = dev_choice["selected"]
    confirms = selected != "mae18" and next(item for item in test_choice["comparisons"] if item["strategy"] == selected)["passes"]
    default = selected if confirms else "mae18"
    ablations = []
    for variant in metrics:
        if variant in config["mainStrategies"]:
            continue
        parent = variant[:-2] + "18" if variant.endswith("10") else "mahalanobis18" if variant == "mahalanobis_diag18" else "mae18"
        ablations.append({"variant": variant, "parent": parent,
                          "jaccardDelta": paired_delta(test_noise, parent, variant, "jaccard5_pm2", config, "test:noise"),
                          "caGapDelta": paired_delta([row for row in test_rows if row["scenario"] == "open"], parent, variant, "meanCaGap5", config, "test:ca")})
    # Determinism and candidate-order invariance at the public scoring interface.
    repeat_checks = 0
    for strategy, metric in metrics.items():
        for index in test[:3]:
            pool = np.delete(np.arange(len(records)), index)
            original, _ = rank(metric.distances(matrix[index], pool), pool, ids)
            repeated, _ = rank(metric.distances(matrix[index], pool), pool, ids)
            reversed_top, _ = rank(metric.distances(matrix[index], pool[::-1]), pool[::-1], ids)
            assert np.array_equal(original, repeated) and np.array_equal(original, reversed_top)
            repeat_checks += 1
    panel = understat_panel(records, matrix, ids, metrics, ca, config)
    cases = example_cases(records, matrix, ids, metrics, ca, ages, config)
    assert digest_file(output / "dev-selection.json") == frozen_selection_sha
    assert {name: digest_file(HERE / name) for name in code_hashes} == code_hashes
    assert digest_bytes((HERE / "config.json").read_bytes()) == lock["configSha256"]
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    peak_mb = peak_rss / (1024 ** 2 if sys.platform == "darwin" else 1024)
    result = {**lock, "environment": {"python": platform.python_version(), "numpy": np.__version__, "platform": platform.platform(),
                                   "threadEnvironment": {key: os.environ.get(key) for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "VECLIB_MAXIMUM_THREADS")}},
              "splits": split_info, "fitPrepareMilliseconds": fit_ms, "development": dev_summary, "test": test_summary,
              "timing": timing, "selection": {"status": "provisional", "defaultStrategy": default,
                "developmentSelected": selected, "developmentSelectionSha256": frozen_selection_sha,
                "testConfirmed": bool(confirms), "developmentComparisons": dev_choice["comparisons"], "testComparisons": test_choice["comparisons"]},
              "gates": {"failures": 0, "developmentRankingChecks": dev_gates["ranking_checks"], "testRankingChecks": test_gates["ranking_checks"],
                        "determinismAndPermutationChecks": repeat_checks, "sourceIdentitiesDisjoint": True},
              "ablations": ablations, "understat": panel, "cases": cases,
              "elapsedSeconds": time.perf_counter() - started, "peakRssMegabytes": peak_mb}
    write_json(output / "summary.json", result)
    report = render_report(result, config, output)
    (HERE.parent / "experiment-report.md").write_text(report)
    progress(json.dumps({"status": "complete", "defaultStrategy": default, "developmentSelected": selected,
                         "testConfirmed": bool(confirms), "seconds": result["elapsedSeconds"], "report": str(HERE.parent / "experiment-report.md")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
