"""Position-general distance families with parameters fitted only on train rows."""

from __future__ import annotations

from typing import Any

import numpy as np

ZERO_NORM_THRESHOLD = 1e-12


def ledoit_wolf(values: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    """Ledoit-Wolf analytic shrinkage toward scaled identity (population covariance)."""
    matrix = np.asarray(values, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[0] < 2 or matrix.shape[1] < 1:
        raise ValueError("Ledoit-Wolf fitting needs a two-dimensional matrix with at least two rows.")
    centered = matrix - matrix.mean(axis=0)
    n, dimensions = centered.shape
    empirical = centered.T @ centered / n
    mu = float(np.trace(empirical) / dimensions)
    target = mu * np.eye(dimensions)
    delta = float(np.square(empirical - target).sum() / dimensions)
    row_norm_sq = np.square(centered).sum(axis=1)
    beta = float((np.square(row_norm_sq).sum() / n - np.square(empirical).sum()) / (dimensions * n))
    beta = min(max(beta, 0.0), max(delta, 0.0))
    shrinkage = 0.0 if delta <= 0.0 else beta / delta
    covariance = (1.0 - shrinkage) * empirical + shrinkage * target
    covariance = (covariance + covariance.T) / 2.0
    return covariance, {
        "estimator": "Ledoit-Wolf analytic shrinkage",
        "fitRows": int(n),
        "shrinkage": float(shrinkage),
        "targetMeanVariance": mu,
        "covariance": covariance.tolist(),
    }


def whitener(covariance: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    eigenvalues, eigenvectors = np.linalg.eigh(np.asarray(covariance, dtype=np.float64))
    floor = max(float(np.trace(covariance) / covariance.shape[0]) * 1e-10, 1e-12)
    safe = np.maximum(eigenvalues, floor)
    transform = eigenvectors / np.sqrt(safe)[None, :]
    return transform, {
        "eigenvalueFloor": floor,
        "flooredEigenvalueCount": int(np.sum(eigenvalues < floor)),
        "smallestEigenvalue": float(eigenvalues.min()),
        "largestEigenvalue": float(eigenvalues.max()),
    }


def group_weights(groups: dict[str, list[str]], feature_names: list[str]) -> np.ndarray:
    lookup = {name: i for i, name in enumerate(feature_names)}
    weights = np.zeros(len(feature_names), dtype=np.float64)
    for names in groups.values():
        for name in names:
            weights[lookup[name]] = 1.0 / (len(groups) * len(names))
    if not np.isfinite(weights).all() or not np.isclose(weights.sum(), 1.0):
        raise ValueError("Feature groups must partition the vector and sum to unit mass.")
    return weights


def fit_strategy(
    family: str,
    fit_matrix: np.ndarray,
    groups: dict[str, list[str]],
    feature_names: list[str],
) -> dict[str, Any]:
    matrix = np.asarray(fit_matrix, dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[1] != len(feature_names) or not np.isfinite(matrix).all():
        raise ValueError("Fit matrix must align with feature names and be finite.")
    fit: dict[str, Any] = {"family": family, "featureNames": list(feature_names), "fitRows": len(matrix)}
    if family in {"zrmse", "mahalanobis"}:
        mean = matrix.mean(axis=0)
        std = matrix.std(axis=0, ddof=0)
        scale = np.where(std > 0, std, 1.0)
        fit["mean"] = mean.tolist()
        fit["std"] = std.tolist()
        fit["scale"] = scale.tolist()
    if family == "mahalanobis":
        cov, cov_info = ledoit_wolf(matrix)
        transform, transform_info = whitener(cov)
        fit["covarianceInfo"] = cov_info
        fit["whitenerInfo"] = transform_info
        fit["whitener"] = transform.tolist()
    if family == "weighted_mae":
        fit["weights"] = group_weights(groups, feature_names).tolist()
        fit["weightPolicy"] = "equal total mass per attribute group; equal within group"
    return fit


def distances(
    family: str,
    query: np.ndarray,
    candidates: np.ndarray,
    fit: dict[str, Any] | None = None,
) -> np.ndarray:
    q = np.asarray(query, dtype=np.float64)
    x = np.asarray(candidates, dtype=np.float64)
    if q.ndim != 1 or x.ndim != 2 or x.shape[1] != q.shape[0]:
        raise ValueError("Distance input dimensions do not match.")
    delta = x - q
    if family == "mae":
        return np.abs(delta).mean(axis=1)
    if family == "rmse":
        return np.sqrt(np.square(delta).mean(axis=1))
    if family == "weighted_mae":
        if fit is None:
            raise ValueError("weighted_mae needs frozen group weights")
        weights = np.asarray(fit["weights"], dtype=np.float64)
        return np.abs(delta) @ weights
    if family == "cosine":
        qnorm = np.linalg.norm(q)
        xnorm = np.linalg.norm(x, axis=1)
        if qnorm <= ZERO_NORM_THRESHOLD or np.any(xnorm <= ZERO_NORM_THRESHOLD):
            raise ValueError("Cosine distance received a zero vector; common pool should exclude it.")
        return np.clip(1.0 - (x @ q) / (xnorm * qnorm), 0.0, 2.0)
    if family == "correlation":
        qc = q - q.mean()
        xc = x - x.mean(axis=1, keepdims=True)
        qnorm = np.linalg.norm(qc)
        xnorm = np.linalg.norm(xc, axis=1)
        query_constant = qnorm <= ZERO_NORM_THRESHOLD
        candidate_constant = xnorm <= ZERO_NORM_THRESHOLD
        if query_constant:
            return np.where(candidate_constant, 0.0, 1.0)
        scores = np.ones(len(x), dtype=np.float64)
        valid = ~candidate_constant
        scores[valid] = np.clip(1.0 - (xc[valid] @ qc) / (xnorm[valid] * qnorm), 0.0, 2.0)
        return scores
    if family == "zrmse":
        if fit is None:
            raise ValueError("zrmse needs fit-only scales")
        scale = np.asarray(fit["scale"], dtype=np.float64)
        return np.sqrt(np.square(delta / scale).mean(axis=1))
    if family == "mahalanobis":
        if fit is None:
            raise ValueError("mahalanobis needs a fit-only whitener")
        transform = np.asarray(fit["whitener"], dtype=np.float64)
        transformed = delta @ transform
        return np.sqrt(np.square(transformed).sum(axis=1))
    raise ValueError(f"Unknown family: {family}")


def numeric_checks() -> dict[str, Any]:
    checks: dict[str, bool] = {}
    def close(name: str, actual: Any, expected: Any) -> None:
        np.testing.assert_allclose(actual, expected, rtol=1e-10, atol=1e-10)
        checks[name] = True

    q = np.array([0.0, 2.0, 4.0])
    x = np.array([[1.0, 4.0, 7.0]])
    close("mae_hand", distances("mae", q, x), [2.0])
    close("rmse_hand", distances("rmse", q, x), [np.sqrt(14 / 3)])
    close("weighted_mae_hand", distances("weighted_mae", q, x, {"weights": [0.2, 0.3, 0.5]}), [2.3])
    close("cosine_positive_scale", distances("cosine", np.array([1., 2., 3.]), np.array([[2., 4., 6.]])), [0.0])
    close("correlation_affine", distances("correlation", np.array([1., 2., 3.]), np.array([[7., 9., 11.]])), [0.0])
    close("correlation_constant_policy", distances("correlation", np.array([4., 4., 4.]), np.array([[2., 2., 2.], [1., 2., 3.]])), [0.0, 1.0])
    groups = {"left": ["a"], "right": ["b", "c"]}
    close("equal_group_mass", group_weights(groups, ["a", "b", "c"]), [0.5, 0.25, 0.25])
    sample = np.random.default_rng(11).normal(size=(100, 5))
    cov, info = ledoit_wolf(sample)
    transform, _ = whitener(cov)
    close("whitener_inverse", transform @ transform.T, np.linalg.inv(cov))
    if not (0 <= info["shrinkage"] <= 1 and np.isfinite(cov).all()):
        raise AssertionError("Invalid shrinkage covariance")
    checks["finite_covariance"] = True
    return {"passed": all(checks.values()), "checkCount": len(checks), "checks": checks}
