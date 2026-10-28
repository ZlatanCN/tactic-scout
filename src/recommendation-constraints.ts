import type { RequestConstraint } from "./state.js";

type RecommendationConstraintTarget = {
  maxAge: number | null;
  minimumCurrentAbility: number | null;
  minimumPotentialAbility: number | null;
  position: string | null;
  resultLimit: number | null;
};

type RecommendationConstraintPatch = Partial<RecommendationConstraintTarget>;

type NumericConstraintField =
  | "maxAge"
  | "minimumCurrentAbility"
  | "minimumPotentialAbility"
  | "resultLimit";

const numericConstraintFields = new Map<string, NumericConstraintField>([
  ["age", "maxAge"],
  ["maxage", "maxAge"],
  ["maximumage", "maxAge"],
  ["年龄", "maxAge"],
  ["年龄上限", "maxAge"],
  ["ca", "minimumCurrentAbility"],
  ["minca", "minimumCurrentAbility"],
  ["minimumca", "minimumCurrentAbility"],
  ["currentability", "minimumCurrentAbility"],
  ["minimumcurrentability", "minimumCurrentAbility"],
  ["当前能力", "minimumCurrentAbility"],
  ["pa", "minimumPotentialAbility"],
  ["minpa", "minimumPotentialAbility"],
  ["minimumpa", "minimumPotentialAbility"],
  ["potentialability", "minimumPotentialAbility"],
  ["minimumpotentialability", "minimumPotentialAbility"],
  ["潜力", "minimumPotentialAbility"],
  ["潜力下限", "minimumPotentialAbility"],
  ["limit", "resultLimit"],
  ["resultlimit", "resultLimit"],
  ["maximumresults", "resultLimit"],
  ["结果数", "resultLimit"],
  ["最多", "resultLimit"],
]);

const normalizedConstraintName = (name: string): string =>
  name
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replaceAll(/[\s_-]/gu, "");

const numericConstraintValue = (value: string): number | null => {
  const match = /\d+/u.exec(value.normalize("NFKC"));

  return match?.[0] === undefined ? null : Number(match[0]);
};

const recommendationPatchFromConstraints = (
  constraints: RequestConstraint[]
): RecommendationConstraintPatch => {
  const patch: RecommendationConstraintPatch = {};

  for (const constraint of constraints) {
    const name = normalizedConstraintName(constraint.name);
    const value = numericConstraintValue(constraint.value);
    const field = numericConstraintFields.get(name);

    if (field !== undefined && value !== null) {
      patch[field] = value;
    } else if (["position", "位置"].includes(name)) {
      patch.position = constraint.value.trim();
    }
  }

  return patch;
};

const recommendationConstraintIsApplied = (
  constraint: RequestConstraint,
  recommendation: RecommendationConstraintTarget
): boolean => {
  const name = normalizedConstraintName(constraint.name);
  const value = constraint.value.normalize("NFKC").trim().toLocaleLowerCase();
  const number = Number(/\d+/u.exec(value)?.[0]);

  if (["age", "maxage", "maximumage", "年龄", "年龄上限"].includes(name)) {
    return recommendation.maxAge === number;
  }

  if (
    [
      "ca",
      "minca",
      "minimumca",
      "currentability",
      "minimumcurrentability",
      "当前能力",
    ].includes(name)
  ) {
    return recommendation.minimumCurrentAbility === number;
  }

  if (
    [
      "pa",
      "minpa",
      "minimumpa",
      "potentialability",
      "minimumpotentialability",
      "潜力",
      "潜力下限",
    ].includes(name)
  ) {
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

export {
  recommendationConstraintIsApplied,
  recommendationPatchFromConstraints,
};

export type { RecommendationConstraintPatch, RecommendationConstraintTarget };
