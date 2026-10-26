"""Frozen-fit profile distances for the local recommendation experiment.

Primary definitions:
https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.cdist.html
https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.distance.correlation.html
https://scikit-learn.org/stable/modules/covariance.html
https://github.com/scikit-learn/scikit-learn/blob/main/sklearn/covariance/_shrunk_covariance.py

All fitted parameters use fit_matrix only. Candidate preparation never refits.
For fixed dimensionality RMSE and L2 have the same ranking; MAE and L1 do too.
"""

from __future__ import annotations

from typing import Any

import numpy as np


ZERO_NORM_THRESHOLD = 1e-12


def _ledoit_wolf(matrix: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    """Ledoit-Wolf's analytic shrinkage, using population covariance (1/n)."""
    values = np.asarray(matrix, dtype=np.float64)
    samples, dimensions = values.shape
    if samples < 2 or dimensions < 1:
        raise ValueError("Covariance fitting needs at least two rows and one feature.")
    centered = values - values.mean(axis=0)
    empirical = centered.T @ centered / samples
    mu = float(np.trace(empirical) / dimensions)
    target = mu * np.eye(dimensions, dtype=np.float64)
    delta = float(np.square(empirical - target).sum() / dimensions)
    row_squared_norms = np.square(centered).sum(axis=1)
    beta = float(
        (np.square(row_squared_norms).sum() / samples - np.square(empirical).sum())
        / (dimensions * samples)
    )
    beta = min(max(beta, 0.0), max(delta, 0.0))
    shrinkage = 0.0 if delta <= 0.0 else beta / delta
    covariance = (1.0 - shrinkage) * empirical + shrinkage * target
    covariance = (covariance + covariance.T) / 2.0
    return covariance, {
        "estimator": "Ledoit-Wolf analytic shrinkage",
        "shrinkage": float(shrinkage),
        "populationCovarianceDivisor": int(samples),
        "targetMeanVariance": mu,
        "covariance": covariance.tolist(),
    }


def _whitener(covariance: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    floor = max(float(np.trace(covariance) / covariance.shape[0]) * 1e-10, 1e-12)
    safe_values = np.maximum(eigenvalues, floor)
    transform = eigenvectors / np.sqrt(safe_values)[None, :]
    return transform, {
        "eigenvalueFloor": floor,
        "flooredEigenvalueCount": int(np.sum(eigenvalues < floor)),
        "smallestFittedEigenvalue": float(eigenvalues.min()),
        "largestFittedEigenvalue": float(eigenvalues.max()),
        "conditionNumberAfterFloor": float(safe_values.max() / safe_values.min()),
    }


class Metric:
    """One score strategy; scores are distances, so smaller is better."""

    def __init__(
        self,
        strategy_id: str,
        family: str,
        indices: np.ndarray,
        weights: np.ndarray,
        level_sensitive: bool,
        feature_names: list[str],
        *,
        mean: np.ndarray | None = None,
        scale: np.ndarray | None = None,
        whitener: np.ndarray | None = None,
        fitted: dict[str, Any] | None = None,
    ) -> None:
        self.strategy_id = strategy_id
        self.family = family
        self.indices = np.asarray(indices, dtype=np.int64)
        self.weights = np.asarray(weights, dtype=np.float64)
        self.level_sensitive = level_sensitive
        self.feature_names = [feature_names[int(index)] for index in self.indices]
        if self.indices.ndim != 1 or len(self.indices) == 0:
            raise ValueError("A metric needs a nonempty one-dimensional feature index.")
        if self.weights.shape != self.indices.shape:
            raise ValueError("Weights and selected features must have the same shape.")
        if not np.isfinite(self.weights).all() or np.any(self.weights < 0):
            raise ValueError("Weights must be finite and nonnegative.")
        if self.weights.sum() <= 0:
            raise ValueError("A metric needs positive total feature weight.")
        self._normalized_weights = self.weights / self.weights.sum()
        self._mean = None if mean is None else np.asarray(mean, dtype=np.float64)
        self._scale = None if scale is None else np.asarray(scale, dtype=np.float64)
        self._whitener = whitener
        self._fitted = fitted or {}
        self._candidate_matrix: np.ndarray | None = None
        self._valid_candidates: np.ndarray | None = None

    def _transform(self, full_values: np.ndarray) -> np.ndarray:
        values = np.asarray(full_values, dtype=np.float64)[..., self.indices]
        if self.family == "correlation":
            values = values - values.mean(axis=-1, keepdims=True)
        if self._mean is not None:
            values = values - self._mean
        if self._scale is not None:
            values = values / self._scale
        if self._whitener is not None:
            values = values @ self._whitener
        return values

    def prepare(self, full_matrix: np.ndarray) -> None:
        matrix = np.asarray(full_matrix, dtype=np.float64)
        if matrix.ndim != 2 or not np.isfinite(matrix).all():
            raise ValueError("Candidate profiles must be a finite two-dimensional matrix.")
        transformed = self._transform(matrix)
        if self.family in {"cosine", "correlation"}:
            norms = np.linalg.norm(transformed, axis=1)
            self._valid_candidates = norms > ZERO_NORM_THRESHOLD
            self._candidate_matrix = np.divide(
                transformed,
                norms[:, None],
                out=np.zeros_like(transformed),
                where=self._valid_candidates[:, None],
            )
        else:
            self._candidate_matrix = transformed
            self._valid_candidates = np.ones(matrix.shape[0], dtype=bool)

    def distances(
        self, query_full_vector: np.ndarray, candidate_indices: np.ndarray
    ) -> np.ndarray:
        if self._candidate_matrix is None or self._valid_candidates is None:
            raise RuntimeError("Call prepare(full_matrix) before scoring candidates.")
        indices = np.asarray(candidate_indices, dtype=np.int64)
        if indices.ndim != 1:
            raise ValueError("Candidate indices must be one-dimensional.")
        query = self._transform(query_full_vector)
        if query.ndim != 1 or not np.isfinite(query).all():
            raise ValueError("The query profile must be a finite one-dimensional vector.")
        candidates = self._candidate_matrix[indices]
        if self.family in {"cosine", "correlation"}:
            norm = float(np.linalg.norm(query))
            if norm <= ZERO_NORM_THRESHOLD:
                return np.full(indices.shape, np.inf, dtype=np.float64)
            scores = np.clip(1.0 - candidates @ (query / norm), 0.0, 2.0)
            scores[~self._valid_candidates[indices]] = np.inf
            return np.asarray(scores, dtype=np.float64)
        delta = candidates - query
        if self.family in {"mae", "weighted_mae", "zmae"}:
            return np.asarray(np.abs(delta) @ self._normalized_weights, dtype=np.float64)
        if self.family in {"rmse", "zrmse"}:
            return np.sqrt(np.square(delta) @ self._normalized_weights)
        if self.family in {"mahalanobis", "mahalanobis_diag"}:
            return np.sqrt(np.einsum("ij,ij->i", delta, delta))
        raise ValueError(f"Unknown distance family: {self.family}")

    def metadata(self) -> dict[str, Any]:
        return {
            "strategyId": self.strategy_id,
            "family": self.family,
            "featureIndices": self.indices.tolist(),
            "featureNames": self.feature_names,
            "featureCount": int(len(self.indices)),
            "weights": self.weights.tolist(),
            "normalizedWeights": self._normalized_weights.tolist(),
            "levelSensitive": self.level_sensitive,
            "preparedRows": (
                0 if self._candidate_matrix is None else int(len(self._candidate_matrix))
            ),
            "undefinedCandidateCount": (
                0
                if self._valid_candidates is None
                else int(np.sum(~self._valid_candidates))
            ),
            "zeroNormPolicy": "distance=+inf; evaluator must use a common valid pool",
            "zeroNormThreshold": ZERO_NORM_THRESHOLD,
            "fitted": self._fitted,
        }


def build_metrics(
    fit_matrix: np.ndarray,
    feature_names: list[str],
    groups: dict[str, list[str]],
) -> tuple[dict[str, Metric], dict[str, Any]]:
    fit = np.asarray(fit_matrix, dtype=np.float64)
    if fit.ndim != 2 or fit.shape[1] != 18 or len(feature_names) != 18:
        raise ValueError("This preregistered experiment requires exactly 18 features.")
    if fit.shape[0] < 2 or not np.isfinite(fit).all():
        raise ValueError("Fitting requires at least two finite profiles.")
    if len(set(feature_names)) != len(feature_names):
        raise ValueError("Feature names must be unique.")
    grouped_names = [name for names in groups.values() for name in names]
    if len(grouped_names) != 18 or set(grouped_names) != set(feature_names):
        raise ValueError("Feature groups must partition all 18 features exactly once.")

    group_weights = np.empty(18, dtype=np.float64)
    feature_lookup = {name: index for index, name in enumerate(feature_names)}
    for names in groups.values():
        if len(names) == 0:
            raise ValueError("Feature groups cannot be empty.")
        for name in names:
            group_weights[feature_lookup[name]] = 1.0 / len(names)

    metrics: dict[str, Metric] = {}
    fits: dict[str, dict[str, Any]] = {}
    covariance18: np.ndarray | None = None

    for count in (18, 10):
        indices = np.arange(count, dtype=np.int64)
        selected = fit[:, indices]
        mean = selected.mean(axis=0)
        raw_scale = selected.std(axis=0, ddof=0)
        scale = np.where(raw_scale > 0.0, raw_scale, 1.0)
        covariance, covariance_info = _ledoit_wolf(selected)
        whiten, whiten_info = _whitener(covariance)
        fitted = {
            "fitRows": int(fit.shape[0]),
            "mean": mean.tolist(),
            "populationStd": raw_scale.tolist(),
            "scale": scale.tolist(),
            "zeroVariancePolicy": "scale=1; no division by zero",
            "covariance": covariance_info,
            "whitening": whiten_info,
        }
        fits[str(count)] = fitted
        if count == 18:
            covariance18 = covariance
        for family in ("mae", "rmse", "cosine", "correlation"):
            strategy_id = f"{family}{count}"
            metrics[strategy_id] = Metric(
                strategy_id,
                family,
                indices,
                np.ones(count),
                family not in {"cosine", "correlation"},
                feature_names,
            )
        metrics[f"zrmse{count}"] = Metric(
            f"zrmse{count}", "zrmse", indices, np.ones(count), True,
            feature_names, mean=mean, scale=scale,
            fitted={"fitRows": int(fit.shape[0]), "mean": mean.tolist(),
                    "scale": scale.tolist(), "stdDof": 0},
        )
        metrics[f"mahalanobis{count}"] = Metric(
            f"mahalanobis{count}", "mahalanobis", indices, np.ones(count), True,
            feature_names, mean=mean, whitener=whiten,
            fitted={"covariance": covariance_info, "whitening": whiten_info},
        )
        metrics[f"weighted_mae{count}"] = Metric(
            f"weighted_mae{count}", "weighted_mae", indices,
            group_weights[indices], True, feature_names,
            fitted={"weightPolicy": "equal total mass per full-18 feature group; restrict for 10"},
        )

    indices18 = np.arange(18, dtype=np.int64)
    fit18 = fits["18"]
    metrics["zmae18"] = Metric(
        "zmae18", "zmae", indices18, np.ones(18), True, feature_names,
        mean=np.asarray(fit18["mean"]), scale=np.asarray(fit18["scale"]),
        fitted={"fitRows": int(fit.shape[0]), "mean": fit18["mean"],
                "scale": fit18["scale"], "stdDof": 0},
    )
    assert covariance18 is not None
    diagonal_covariance = np.diag(np.diag(covariance18))
    diag_whitener, diag_whiten_info = _whitener(diagonal_covariance)
    metrics["mahalanobis_diag18"] = Metric(
        "mahalanobis_diag18", "mahalanobis_diag", indices18, np.ones(18), True,
        feature_names, mean=np.asarray(fit18["mean"]), whitener=diag_whitener,
        fitted={
            "ablation": "same fitted Ledoit-Wolf covariance, off-diagonal entries zeroed",
            "parentShrinkage": fit18["covariance"]["shrinkage"],
            "covariance": diagonal_covariance.tolist(),
            "whitening": diag_whiten_info,
        },
    )
    for group_name, removed_names in groups.items():
        removed = set(removed_names)
        indices = np.asarray(
            [index for index, name in enumerate(feature_names) if name not in removed],
            dtype=np.int64,
        )
        strategy_id = f"mae_no_{group_name}"
        metrics[strategy_id] = Metric(
            strategy_id, "mae", indices, np.ones(len(indices)), True,
            feature_names, fitted={"removedGroup": group_name},
        )

    return metrics, {
        "fitRows": int(fit.shape[0]),
        "featureNames": list(feature_names),
        "groups": groups,
        "full18GroupWeights": group_weights.tolist(),
        "fitPolicy": "all corpus preprocessing frozen from fit_matrix only",
        "fitsByFeatureCount": fits,
        "strategyCount": len(metrics),
    }


def run_numeric_checks() -> dict[str, Any]:
    """Small independent worked examples; no corpus or model calls."""
    checks: dict[str, bool] = {}
    names = ["a", "b", "c"]
    indices = np.arange(3)

    def compare(name: str, actual: Any, expected: Any, *, atol: float = 1e-10) -> None:
        np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=atol)
        checks[name] = True

    def distance(family: str, query: list[float], rows: list[list[float]], weights: list[float] | None = None) -> np.ndarray:
        metric = Metric("numeric", family, indices, np.ones(3) if weights is None else np.asarray(weights), family not in {"cosine", "correlation"}, names)
        metric.prepare(np.asarray(rows))
        return metric.distances(np.asarray(query), np.arange(len(rows)))

    compare("mae_hand_computed", distance("mae", [90, 88, 85], [[86, 84, 80]]), [13 / 3])
    compare("rmse_hand_computed", distance("rmse", [90, 88, 85], [[86, 84, 80]]), [np.sqrt(19)])
    compare("weighted_mae_hand_computed", distance("weighted_mae", [0, 0, 0], [[1, 3, 5]], [1, 2, 1]), [3])
    compare("cosine_orthogonal", distance("cosine", [1, 0, 0], [[0, 1, 0]]), [1])
    compare("cosine_positive_scale", distance("cosine", [1, 2, 3], [[2, 4, 6]]), [0])
    compare("correlation_affine", distance("correlation", [1, 2, 3], [[7, 9, 11]]), [0])
    compare("correlation_reversed", distance("correlation", [1, 2, 3], [[3, 2, 1]]), [2])
    compare("centered_cosine_equals_correlation", distance("cosine", [-1, 0, 1], [[1, 0, -1]]), distance("correlation", [1, 2, 3], [[3, 2, 1]]))
    rows = np.asarray([[1, 2, 0], [4, 0, 0], [1, 1, 1]], dtype=np.float64)
    compare("mae_l1_equivalence", distance("mae", [0, 0, 0], rows.tolist()) * 3, [3, 4, 3])
    compare("rmse_l2_equivalence", distance("rmse", [0, 0, 0], rows.tolist()) * np.sqrt(3), np.sqrt([5, 16, 3]))
    zero_query = distance("cosine", [0, 0, 0], [[1, 2, 3]])
    constant_profile = distance("correlation", [1, 2, 3], [[7, 7, 7]])
    constant_query = distance("correlation", [7, 7, 7], [[1, 2, 3]])
    if not all(np.isinf(result).all() for result in (zero_query, constant_profile, constant_query)):
        raise AssertionError("Zero-norm queries and candidates must return +inf.")
    checks["undefined_norm_policy"] = True

    example = np.random.RandomState(0).multivariate_normal([0, 0], [[0.4, 0.2], [0.2, 0.8]], size=50)
    covariance, covariance_info = _ledoit_wolf(example)
    compare("ledoit_wolf_official_example", covariance, [[0.4406, 0.1616], [0.1616, 0.8022]], atol=1e-3)
    transform, _ = _whitener(covariance)
    compare("whitening_inverse_identity", transform @ transform.T, np.linalg.inv(covariance))
    if not (np.isfinite(transform).all() and 0 <= covariance_info["shrinkage"] <= 1):
        raise AssertionError("The fitted shrinkage transform must be finite.")
    checks["finite_shrinkage"] = True

    synthetic_names = [f"feature_{index}" for index in range(18)]
    synthetic_groups = {
        "physical": synthetic_names[:5],
        "finishing": synthetic_names[5:10],
        "link": synthetic_names[10:],
    }
    synthetic = np.random.RandomState(17).randint(1, 101, size=(40, 18)).astype(np.float64)
    strategies, fitted = build_metrics(synthetic, synthetic_names, synthetic_groups)
    if len(strategies) != 19:
        raise AssertionError("The preregistered metric matrix must contain 19 strategies.")
    checks["registered_strategy_count"] = True
    balanced = strategies["weighted_mae18"].metadata()["normalizedWeights"]
    compare("equal_feature_group_mass", [sum(balanced[:5]), sum(balanced[5:10]), sum(balanced[10:])], [1 / 3, 1 / 3, 1 / 3])
    compare("weights_frozen_before_feature_ablation", strategies["weighted_mae10"].weights, [0.2] * 10)
    compare("diagonal_ablation_uses_same_shrunk_covariance", strategies["mahalanobis_diag18"].metadata()["fitted"]["covariance"], np.diag(np.diag(fitted["fitsByFeatureCount"]["18"]["covariance"]["covariance"])))
    for metric in strategies.values():
        metric.prepare(synthetic)
        if not np.isfinite(metric.distances(synthetic[0], np.arange(1, 40))).all():
            raise AssertionError(f"Non-finite score on ordinary synthetic profiles: {metric.strategy_id}")
    checks["all_strategies_finite_on_nonconstant_profiles"] = True

    return {"passed": True, "checkCount": len(checks), "checks": checks}
