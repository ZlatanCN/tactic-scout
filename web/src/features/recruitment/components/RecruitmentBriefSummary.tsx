import type { RecruitmentBrief } from "../../../../../src/domain/recruitment-brief";
import { Button } from "@/shared/ui/button";
import type { RecruitmentReport } from "../../../../../src/domain/reports.js";

function criterionValueText(criterion: RecruitmentBrief["criteria"][number]): string {
  const value = criterion.value;
  const text = Array.isArray(value) ? value.join("、") : value === null ? "" : String(value);
  const compare = criterion.operator === "lt" ? "<" : criterion.operator === "lte" ? "≤"
    : criterion.operator === "gt" ? ">" : criterion.operator === "gte" ? "≥" : "";
  switch (criterion.field) {
    case "position": return criterion.operator === "any" ? "位置不限" : `位置 ${text}`;
    case "age": return criterion.operator === "prefer_low" ? "年龄偏年轻"
      : criterion.operator === "prefer_high" ? "年龄偏资深"
        : `年龄 ${compare} ${text}岁`;
    case "minimumMinutes": return `出场时间 ${compare || "≥"} ${text}分钟`;
    case "competition": return `${criterion.operator === "not_in" || criterion.strength === "excluded" ? "排除" : "赛事"}${text}`;
    case "season": return `赛季 ${text}`;
    case "budget": return `预算 ${compare || "≤"} ${text}${criterion.unit ?? ""}`;
    case "heightCm": return criterion.operator === "prefer_high" || criterion.operator === "prefer_low"
      ? `身高偏${criterion.operator === "prefer_high" ? "高" : "低"}`
      : `身高 ${compare} ${text}cm`;
    case "potentialAbility": return criterion.operator === "prefer_high" || criterion.operator === "prefer_low"
      ? `FM 潜力偏${criterion.operator === "prefer_high" ? "高" : "低"}`
      : `FM PA ${compare} ${text}/200`;
    case "currentAbility": return criterion.operator === "prefer_high" || criterion.operator === "prefer_low"
      ? `FM 当前能力偏${criterion.operator === "prefer_high" ? "高" : "低"}`
      : `FM CA ${compare} ${text}/200`;
    case "fmAttribute": return `FM ${criterion.attributeKey ?? "属性"} ${criterion.operator === "prefer_high" || criterion.operator === "prefer_low"
      ? `偏${criterion.operator === "prefer_high" ? "高" : "低"}` : `${compare} ${text}`}`;
    case "nationality": return `${criterion.strength === "excluded" || criterion.operator === "not_in" ? "排除国籍" : "国籍"}${text}`;
    case "club": return `${criterion.strength === "excluded" || criterion.operator === "not_in" ? "排除球队" : "球队"}${text}`;
    case "capability": return `${text}${criterion.operator === "prefer_high" ? "偏好" : "能力要求"}`;
    case "other": return text;
  }
}

function criterionIntentLabel(criterion: RecruitmentBrief["criteria"][number]): string {
  if (criterion.strength === "excluded") return "排除";
  if (criterion.strength === "preferred") return "偏好";
  return "必须";
}

function criterionKey(criterion: RecruitmentBrief["criteria"][number]): string {
  return JSON.stringify([criterion.field, criterion.attributeKey ?? null, criterion.operator, criterion.value, criterion.unit ?? null, criterion.strength]);
}

export function RecruitmentBriefSummary({ brief, report, onEdit, disabled }: {
  brief: RecruitmentBrief;
  onEdit: () => void;
  disabled: boolean;
  report?: RecruitmentReport | null;
}) {
  const reference = brief.referencePlayer?.value;
  const title = brief.task === "similarity" ? `寻找与${reference ?? "参考球员"}相似的球员`
    : brief.task === "replacement" ? `寻找${reference ?? "参考球员"}的替代者` : "按位置与特点寻找球员";
  const criterionCoverage = new Map((report?.searchScopes ?? []).flatMap(scope => scope.fmCriterionCoverage ?? []).map(item => [item.key, item]));
  const agePreferenceCoverage = report?.searchScopes?.slice().reverse().find(scope => scope.agePreferenceCoverage)?.agePreferenceCoverage;
  const details = [brief.targetTeam ? `为${brief.targetTeam.value}补强` : null,
    ...brief.criteria.map(criterion => {
      const coverage = criterionCoverage.get(criterionKey(criterion));
      const fmField = ["heightCm", "potentialAbility", "currentAbility", "fmAttribute"].includes(criterion.field);
      const agePreferenceText = criterion.field === "age" && criterion.strength === "preferred"
        ? agePreferenceCoverage
          ? `（按可用年龄资料排序，${agePreferenceCoverage.knownRecords}/${agePreferenceCoverage.eligibleRecords} 条有年龄）`
          : "（等待年龄数据排序）"
        : "";
      const coverageText = agePreferenceText || (!fmField ? "" : !coverage ? "（待核验 FM 数据）"
        : criterion.strength === "preferred"
        ? `（FM偏好排序 ${coverage.knownRecords}/${coverage.eligibleRecords} 有数据，${coverage.satisfiedRecords} 条达到表达的数值条件）`
          : `（FM满足 ${coverage.satisfiedRecords}/${coverage.knownRecords}，有画像 ${coverage.knownRecords}/${coverage.eligibleRecords}）`);
      return `${criterionIntentLabel(criterion)}：${criterionValueText(criterion)}${criterion.basis === "inferred" ? "（推断）" : ""}${coverageText}`;
    }),
  ].filter(Boolean);
  return <section aria-label="当前找人需求" className="min-w-0 border-y border-border bg-muted/40 px-4 py-3 sm:px-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="m-0 break-words text-sm font-medium leading-6">{title}</p>
        {details.length > 0 && <ul className="mb-0 mt-1 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs leading-5 text-muted-foreground">{details.map((detail, index) => <li className="break-words" key={`${index}-${detail}`}>{detail}</li>)}</ul>}
      </div>
      <Button type="button" variant="ghost" size="sm" className="min-h-10 shrink-0" disabled={disabled} onClick={onEdit}>修改需求</Button>
    </div>
  </section>;
}
