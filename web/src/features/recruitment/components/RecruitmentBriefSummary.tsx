import type { RecruitmentBrief } from "../../../../../src/domain/recruitment-brief";
import { Button } from "@/shared/ui/button";
import { positionLabels } from "./report-labels";
import { competitionNamesMatch } from "../../../../../src/domain/competition-names";

function competitionLabel(value: string): string {
  return ["英超", "德甲", "西甲", "意甲", "法甲"].find(label => competitionNamesMatch(value, label)) ?? value;
}

export function RecruitmentBriefSummary({ brief, onEdit, disabled }: {
  brief: RecruitmentBrief;
  onEdit: () => void;
  disabled: boolean;
}) {
  const reference = brief.referencePlayer?.value;
  const title = brief.task === "similarity" ? `寻找与${reference ?? "参考球员"}相似的球员`
    : brief.task === "replacement" ? `寻找${reference ?? "参考球员"}的替代者` : "按位置与特点寻找球员";
  const details = [brief.targetTeam ? `为${brief.targetTeam.value}补强` : null,
    brief.allowsAnyPosition ? "位置不限" : null,
    brief.positions.length ? brief.positions.map(position => positionLabels[position]).join("、") : null,
    brief.filters.maxAge === null ? null : `${brief.filters.maxAge}岁及以下`,
    brief.filters.competition ? `仅${competitionLabel(brief.filters.competition)}` : null,
    ...brief.filters.excludedCompetitions.map(competition => `排除${competitionLabel(competition)}`),
    brief.filters.minimumMinutes > 0 ? `至少${brief.filters.minimumMinutes}分钟` : null,
    brief.filters.season ? `${brief.filters.season}赛季` : null,
    ...brief.priorities.map(item => `${item.value}${item.basis === "inferred" ? "（可调整）" : ""}`),
    ...brief.constraints.filter(item => item.kind === "budget" || item.kind === "other").map(item => `${item.requirement.value}${item.strength === "preferred" ? "（偏好）" : ""}`),
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
