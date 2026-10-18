import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { formatDate } from "../lib/format-date";
import type { SavedRecruitmentPlan } from "../lib/plans";

export function SavedPlansSidebar({
  plans,
  activePlanId,
  disabled,
  onOpen,
  onDelete,
  onNew,
}: {
  plans: SavedRecruitmentPlan[];
  activePlanId: string | null;
  disabled: boolean;
  onOpen: (plan: SavedRecruitmentPlan) => void;
  onDelete: (planId: string) => void;
  onNew: () => void;
}) {
  return (
    <Card className="gap-0 border-0 bg-transparent py-0 shadow-none ring-0">
      <CardHeader className="gap-3 px-0 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">招募计划</CardTitle>
          <Badge variant="outline" className="border-0 bg-transparent tabular-nums">{plans.length}</Badge>
        </div>
        <Button type="button" onClick={onNew} disabled={disabled} variant="outline" className="w-full justify-start gap-2 bg-card">
          <Plus aria-hidden="true" />新建计划
        </Button>
      </CardHeader>
      <CardContent className="max-h-64 space-y-2 overflow-y-auto overscroll-contain px-0 xl:max-h-none">
        {disabled && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900" role="status">
          当前调查尚未结束；完成或恢复结果后即可切换计划。
        </p>}
        {plans.length ? <ul className="space-y-1" aria-label="保存的招募计划">
          {plans.map((plan) => {
            const active = activePlanId === plan.id;
            return <li key={plan.id} className={`group rounded-lg border transition-colors ${active ? "border-primary/15 bg-card shadow-sm" : "border-transparent hover:border-border hover:bg-card"}`}>
              <div className="flex min-w-0 items-start gap-2 p-3">
                <button type="button" className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring" aria-label={`打开招募计划：${plan.name}`} onClick={() => onOpen(plan)} disabled={disabled}>
                  <span className="block break-words text-sm font-medium text-foreground">{plan.name}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{plan.lastReportedAt ? `最近报告 ${formatDate(plan.lastReportedAt)}` : "对话已保存，尚无报告"}</span>
                </button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除招募计划：${plan.name}`} onClick={() => onDelete(plan.id)} disabled={disabled} className="text-muted-foreground opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>;
          })}
        </ul> : <p className="rounded-lg border border-dashed bg-card/70 p-4 text-xs leading-5 text-muted-foreground">
          还没有计划。开始调查后，可以保存并随时继续。
        </p>}
      </CardContent>
    </Card>
  );
}
