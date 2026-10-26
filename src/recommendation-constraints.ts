import type { RequestConstraint } from "./state.js";

type RecommendationConstraintTarget = {
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  position: string | null;
  resultLimit: number | null;
};

const normalizedConstraintName = (name: string): string =>
  name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]/gu, "");

const recommendationConstraintIsApplied = (
  constraint: RequestConstraint,
  recommendation: RecommendationConstraintTarget
): boolean => {
  const name = normalizedConstraintName(constraint.name);
  const value = constraint.value.normalize("NFKC").trim().toLocaleLowerCase();
  const number = Number(/\d+/u.exec(value)?.[0]);

  if (["age", "maxage", "年龄", "年龄上限"].includes(name)) {
    return recommendation.maxAge === number;
  }

  if (["ca", "minca", "currentability", "当前能力"].includes(name)) {
    return recommendation.minimumCurrentAbility === number;
  }

  if (["pa", "minpa", "potentialability", "潜力"].includes(name)) {
    return recommendation.minimumPotentialAbility === number;
  }

  if (["position", "位置"].includes(name)) {
    return recommendation.position?.toLocaleLowerCase() === value;
  }

  if (["limit", "resultlimit", "结果数", "最多"].includes(name)) {
    return recommendation.resultLimit === number;
  }

  return false;
};

export { recommendationConstraintIsApplied };

export type { RecommendationConstraintTarget };
