import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allProgressSteps, visibleProgressSteps } from "./progress";
import type { PendingTurnRequest } from "./turn-requests";
import type { RecruitmentProgress } from "../../src/domain/schemas.js";

export type ProgressConnection = "idle" | "connecting" | "live" | "stale" | "incompatible";

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function progressStepCountLabel(events: RecruitmentProgress["events"]): string {
  return `${allProgressSteps(events).length} 步`;
}

function progressMessageForUser(stage: RecruitmentProgress["stage"], message: string, status: RecruitmentProgress["events"][number]["status"]): string {
  if (status !== "started") return message;
  const stageMessages: Record<RecruitmentProgress["stage"], string> = {
    starting: "正在准备本轮调查", planning: "正在梳理需求并安排调查", methodology: "正在查找角色与能力评估的参考资料",
    team_sample: "正在查看目标球队已有的球员资料", candidate_search: "正在按当前需求查找球员", player_evaluation: "正在比较球员在重点能力上的比赛表现",
    external_signal: "正在补充可用的外部表现参考", historical_archive: "正在查看候选球员的历史赛季记录", report_search: "正在查找球员报告和观察资料",
    synthesizing: "正在整理候选人、数据依据和待核实项", review: "正在核对推荐结论是否有数据支持", team_roster_context: "正在补充目标球队的公开阵容信息",
    asking_user: "正在整理需要你确认的问题", completed: "本轮调查已完成", cancelling: "正在结束本轮调查", cancelled: "本轮调查已停止", failed: "本轮调查暂未完成",
  };
  return stageMessages[stage] ?? message;
}

function eventPresentation(event: RecruitmentProgress["events"][number], active: boolean) {
  if (event.status === "failed") return { label: "未完成", className: "border-destructive/30 bg-destructive/5 text-destructive", marker: "!" };
  if (event.status === "notice") return { label: "需要留意", className: "border-amber-300 bg-amber-50 text-amber-900", marker: "!" };
  if (event.status === "cancelled") return { label: "已停止", className: "border-border bg-muted text-muted-foreground", marker: "×" };
  if (event.status === "waiting_for_user") return { label: "等待补充", className: "border-amber-300 bg-amber-50 text-amber-900", marker: "?" };
  if (event.status === "completed") return { label: "已完成", className: "border-primary/20 bg-secondary text-primary", marker: "✓" };
  return active
    ? { label: "进行中", className: "border-primary/30 bg-primary text-primary-foreground", marker: "·" }
    : { label: "已开始", className: "border-border bg-card text-muted-foreground", marker: "" };
}

export function ProgressTimeline({ events, active, label, compact = false }: {
  events: RecruitmentProgress["events"];
  active: boolean;
  label: string;
  compact?: boolean;
}) {
  const steps = compact ? visibleProgressSteps(events) : allProgressSteps(events);
  return <ol className="relative space-y-2.5 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-border before:content-['']" aria-label={label}>
    {steps.map((event, index) => {
      const current = index === steps.length - 1;
      const isActive = current && active && event.status === "started";
      const state = eventPresentation(event, isActive);
      const repeatLabel = event.occurrence > 1 ? `第 ${event.occurrence} 次` : null;
      return <li className="relative flex items-start gap-3" key={`${event.stage}:${event.occurrence}`} aria-current={isActive ? "step" : undefined}>
        <span className={`z-10 grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${state.className}`} aria-hidden="true">{state.marker}</span>
        <span className="min-w-0 flex-1 pb-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] font-medium ${state.className}`}>{state.label}</Badge>
            {repeatLabel && <span className="text-[10px] text-muted-foreground">{repeatLabel}</span>}
          </span>
          <span className="mt-1 block break-words text-xs leading-5 text-foreground">{progressMessageForUser(event.stage, event.message, event.status)}</span>
        </span>
      </li>;
    })}
  </ol>;
}

export function RecruitmentProgressCard({
  progress,
  progressConnection,
  pendingTurnRequest,
  elapsedSeconds,
  cancellingRequestId,
  onCancel,
  onResumeReanalysis,
}: {
  progress: RecruitmentProgress | null;
  progressConnection: ProgressConnection;
  pendingTurnRequest: PendingTurnRequest;
  elapsedSeconds: number;
  cancellingRequestId: string | null;
  onCancel: () => void;
  onResumeReanalysis: () => void;
}) {
  const stopped = progress?.stage === "cancelled";
  const cancelling = cancellingRequestId === pendingTurnRequest.requestId || progress?.stage === "cancelling";
  const activeMessage = progress
    ? progressMessageForUser(progress.stage, progress.message, progress.events.at(-1)?.status ?? "started")
    : "正在准备本轮调查";
  const statusHint = progress?.stage === "cancelling"
    ? "正在确认调查已停止。"
    : stopped
      ? "本轮调查已停止。"
      : pendingTurnRequest.outcomeUnknown
        ? progressConnection === "live" ? "已重新连接调查进度；找回结果不会重复启动调查。" : progressConnection === "incompatible" ? "当前服务版本无法读取这轮进度。请保留原输入，重启服务后再恢复。" : progressConnection === "stale" ? "进度暂时不可用；连接恢复后会继续查找本轮结果。" : "正在确认这轮调查的状态；请保留原输入。"
        : progressConnection === "incompatible" ? "当前服务版本无法显示实时进度；本轮仍在继续，结束后重启服务即可查看调查步骤。"
          : progressConnection === "stale" ? "阶段更新暂时不可用；本轮仍在继续，计时会保留。"
            : progressConnection === "live" ? "正在显示球探调查的实际步骤。"
              : "正在连接实时阶段；等待时间会持续更新。";

  return <Card className="ml-9 gap-0 border-primary/15 bg-muted/70 py-0 shadow-none">
    <CardContent className="space-y-4 p-4">
      <div className="flex items-start gap-2.5" role="status" aria-live="polite" aria-atomic="true">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${progress?.active === false ? "bg-muted-foreground" : "animate-pulse bg-primary motion-reduce:animate-none"}`} aria-hidden="true" />
        <strong className="text-sm font-medium leading-6">{activeMessage}</strong>
      </div>
      <ProgressTimeline events={progress?.events ?? []} active={progress?.active ?? false} compact label="本轮调查各阶段状态" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <span>已用时 {elapsedLabel(elapsedSeconds)}</span><span>阶段记录 {progressStepCountLabel(progress?.events ?? [])}</span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" role="status" aria-live="polite" aria-atomic="true">{statusHint}</p>
      <div className="flex flex-wrap items-center gap-2">
        {!stopped && <Button type="button" variant="outline" size="sm" className="border-destructive/30 text-destructive hover:bg-destructive/5" onClick={onCancel} disabled={cancelling}>
          {cancelling ? "正在结束本轮…" : "停止调查"}
        </Button>}
        {pendingTurnRequest.outcomeUnknown && pendingTurnRequest.isReanalysis && <Button type="button" variant="link" size="sm" onClick={onResumeReanalysis}>恢复重新分析</Button>}
        {!pendingTurnRequest.outcomeUnknown && !cancelling && !stopped && progressConnection === "live" && elapsedSeconds >= 20 && <span className="text-xs text-muted-foreground">你可以展开上方步骤查看进度，也可以随时停止。</span>}
      </div>
    </CardContent>
  </Card>;
}
