import { PositionSchema, type Position } from "../domain/position-contracts.js";
import { requestedCapabilityEvidenceAreasFromBrief } from "../domain/recruitment-capabilities.js";
import type { FmSearchCriterion, RecruitmentBrief, RecruitmentCriterion } from "../domain/recruitment-brief.js";

export interface CompiledRecruitmentCriteria {
  positions: Position[];
  allowsAnyPosition: boolean;
  minAge: number | null;
  maxAge: number | null;
  agePreference: "younger" | "older" | null;
  minimumMinutes: number;
  competition: string | null;
  excludedCompetitions: string[];
  season: string | null;
  capabilityPriorities: Array<{ value: string; basis: "explicit" | "inferred"; quote: string }>;
  fmCriteria: FmSearchCriterion[];
  unsupportedCriteria: RecruitmentCriterion[];
  unsupportedRequired: RecruitmentCriterion[];
}

function strings(value: RecruitmentCriterion["value"]): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  return [];
}

function number(value: RecruitmentCriterion["value"]): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positionsFrom(value: RecruitmentCriterion["value"]): Position[] {
  return strings(value).flatMap((item) => {
    const parsed = PositionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function sameCriterion(left: RecruitmentCriterion, right: RecruitmentCriterion): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compile the semantic ledger into supported search and evidence projections. */
export function compileRecruitmentCriteria(
  brief: Pick<RecruitmentBrief, "criteria"> | null | undefined,
  options: {
    abilityProfilesEnabled?: boolean;
    verifiedProfileLinksAvailable?: boolean;
    targetTeam?: string | null;
    ageSupported?: boolean;
  } = {},
): CompiledRecruitmentCriteria {
  const compiled: CompiledRecruitmentCriteria = {
    positions: [], allowsAnyPosition: false, minAge: null, maxAge: null, agePreference: null,
    minimumMinutes: 0, competition: null, excludedCompetitions: [], season: null,
    capabilityPriorities: [], fmCriteria: [], unsupportedCriteria: [], unsupportedRequired: [],
  };
  if (!brief) return compiled;

  const supported = new Set<RecruitmentCriterion>();
  const positionCriteria: RecruitmentCriterion[] = [];
  const requiredCompetitions: RecruitmentCriterion[] = [];
  const markSupported = (criterion: RecruitmentCriterion) => supported.add(criterion);

  for (const criterion of brief.criteria) {
    const value = number(criterion.value);
    switch (criterion.field) {
      case "position": {
        positionCriteria.push(criterion);
        const positionValues = positionsFrom(criterion.value);
        if (criterion.strength === "required" && criterion.operator === "any") {
          compiled.positions = [];
          compiled.allowsAnyPosition = true;
          markSupported(criterion);
        } else if (criterion.strength === "required" && criterion.operator === "in"
          && positionValues.length > 0 && positionValues.length === strings(criterion.value).length) {
          compiled.positions = positionValues;
          compiled.allowsAnyPosition = false;
          markSupported(criterion);
        }
        break;
      }
      case "age":
        if (criterion.strength === "required" && value !== null) {
          if (criterion.operator === "lt") compiled.maxAge = Math.ceil(value) - 1;
          else if (criterion.operator === "lte") compiled.maxAge = Math.floor(value);
          else if (criterion.operator === "gt") compiled.minAge = Math.floor(value) + 1;
          else if (criterion.operator === "gte") compiled.minAge = Math.ceil(value);
          else if (criterion.operator === "eq") compiled.minAge = compiled.maxAge = value;
          else break;
          markSupported(criterion);
          if (options.ageSupported === false) compiled.unsupportedRequired.push(criterion);
        } else if (criterion.strength === "preferred") {
          if (["prefer_low", "lt", "lte"].includes(criterion.operator)) {
            compiled.agePreference = "younger";
            markSupported(criterion);
          } else if (["prefer_high", "gt", "gte"].includes(criterion.operator)) {
            compiled.agePreference = "older";
            markSupported(criterion);
          }
        }
        break;
      case "minimumMinutes":
        if (criterion.strength === "required" && value !== null
          && (criterion.operator === "gt" || criterion.operator === "gte")) {
          compiled.minimumMinutes = Math.ceil(value) + (criterion.operator === "gt" ? 1 : 0);
          markSupported(criterion);
        }
        break;
      case "competition": {
        const names = strings(criterion.value).filter(Boolean);
        if ((criterion.strength === "excluded" || criterion.operator === "not_in") && names.length > 0) {
          compiled.excludedCompetitions.push(...names);
          markSupported(criterion);
        } else if (criterion.strength === "required"
          && (criterion.operator === "in" || criterion.operator === "eq") && names.length === 1) {
          requiredCompetitions.push(criterion);
          compiled.competition = names[0] ?? null;
          markSupported(criterion);
        }
        break;
      }
      case "season":
        if (criterion.strength === "required" && criterion.operator === "eq" && strings(criterion.value).length === 1) {
          compiled.season = strings(criterion.value)[0] ?? null;
          markSupported(criterion);
        }
        break;
      case "capability": {
        const name = strings(criterion.value)[0];
        const hasEvidenceMapping = name && requestedCapabilityEvidenceAreasFromBrief(
          { criteria: [criterion] as RecruitmentBrief["criteria"] },
          undefined,
          options.abilityProfilesEnabled,
        ).length > 0;
        if (criterion.strength !== "excluded" && name && hasEvidenceMapping && criterion.operator === "match") {
          compiled.capabilityPriorities.push({ value: name, basis: criterion.basis, quote: criterion.quote });
          markSupported(criterion);
        }
        break;
      }
      case "heightCm":
      case "potentialAbility":
      case "currentAbility":
      case "fmAttribute": {
        const numericOperator = ["lt", "lte", "gt", "gte"].includes(criterion.operator);
        const directionalPreference = criterion.strength === "preferred"
          && ["prefer_high", "prefer_low"].includes(criterion.operator) && criterion.value === null;
        if ((numericOperator && value !== null) || directionalPreference) {
          compiled.fmCriteria.push(criterion as FmSearchCriterion);
          markSupported(criterion);
        }
        break;
      }
      case "budget":
      case "nationality":
      case "club":
      case "other":
        break;
    }
  }

  // A single in-list expresses alternatives. Multiple position criteria express
  // a conjunction that this search index cannot verify as one scope.
  if (positionCriteria.length > 1) {
    compiled.positions = [];
    compiled.allowsAnyPosition = false;
    for (const criterion of positionCriteria) supported.delete(criterion);
  }
  if (requiredCompetitions.length > 1) {
    compiled.competition = null;
    for (const criterion of requiredCompetitions) supported.delete(criterion);
  }

  compiled.excludedCompetitions = [...new Set(compiled.excludedCompetitions)];
  const standaloneFmScopeAvailable = !options.targetTeam && compiled.minimumMinutes === 0
    && compiled.competition === null && compiled.season === null && compiled.excludedCompetitions.length === 0;
  const fmScopeAvailable = options.abilityProfilesEnabled
    && (standaloneFmScopeAvailable || options.verifiedProfileLinksAvailable === true);
  if (!fmScopeAvailable) {
    for (const criterion of compiled.fmCriteria) supported.delete(criterion);
  }
  compiled.unsupportedCriteria = brief.criteria.filter(criterion => !supported.has(criterion));
  compiled.unsupportedRequired = [...compiled.unsupportedRequired,
    ...compiled.unsupportedCriteria.filter(item => item.strength !== "preferred"),
  ].filter((item, index, all) => all.findIndex(candidate => sameCriterion(candidate, item)) === index);
  return compiled;
}
