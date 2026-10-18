import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Check, ChevronDown, CircleDot, CircleHelp, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import { allProgressSteps, visibleProgressSteps } from "../lib/progress";
import type { PendingTurnRequest } from "../lib/turn-requests";
import { type RecruitmentCandidatePreview, type RecruitmentProgress } from "../../../../../src/domain/conversation.js";

// The expandable task-row pattern is inspired by Beautiful UI; every row here is backed by a real graph progress event.

export type ProgressConnection = "idle" | "connecting" | "live" | "stale" | "incompatible";

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function progressStepCountLabel(events: RecruitmentProgress["events"]): string {
  return `${allProgressSteps(events).length} 步`;
}

function progressMessageForUser(stage: RecruitmentProgress["stage"], message: string, status: RecruitmentProgress["events"][number]["status"]): string {
  if (status !== "started") return message;
  if (stage === "understanding" || stage === "reference_identity") return message;
  const stageMessages: Record<RecruitmentProgress["stage"], string> = {
    understanding: "正在理解你的找人需求", reference_identity: "正在确认参考球员并读取画像",
    starting: "正在准备本轮调查", planning: "正在梳理需求并安排调查", methodology: "正在查找角色与能力评估的参考资料",
    team_sample: "正在查看目标球队已有的球员资料", player_detail: "正在读取候选的位置记录和近期表现", match_detail: "正在读取一场比赛的名单和射门记录", candidate_search: "正在按当前需求查找球员", player_evaluation: "正在比较球员在重点能力上的比赛表现",
    external_signal: "正在补充可用的外部表现参考", historical_archive: "正在查看候选球员的历史赛季记录", report_search: "正在查找球员报告和观察资料",
    synthesizing: "正在整理候选人、数据依据和待核实项", review: "正在核对推荐结论是否有数据支持", team_roster_context: "正在补充目标球队的公开阵容信息",
    asking_user: "正在整理需要你确认的问题", completed: "本轮调查已完成", cancelling: "正在结束本轮调查", cancelled: "本轮调查已停止", failed: "本轮调查暂未完成",
  };
  return stageMessages[stage] ?? message;
}

function eventPresentation(event: RecruitmentProgress["events"][number], active: boolean) {
  if (event.status === "failed") return { label: "未完成", className: "border-destructive/20 bg-destructive/5 text-destructive", Icon: CircleX };
  if (event.status === "notice") return { label: "需要留意", className: "border-amber-300 bg-amber-50 text-amber-950", Icon: TriangleAlert };
  if (event.status === "cancelled") return { label: "已停止", className: "border-border bg-muted text-muted-foreground", Icon: CircleX };
  if (event.status === "waiting_for_user") return { label: "等待补充", className: "border-amber-300 bg-amber-50 text-amber-950", Icon: CircleHelp };
  if (event.status === "completed") return { label: "已完成", className: "border-primary/20 bg-secondary text-primary", Icon: Check };
  return active
    ? { label: "进行中", className: "border-primary/20 bg-primary/5 text-primary", Icon: LoaderCircle }
    : { label: "已开始", className: "border-border bg-card text-muted-foreground", Icon: CircleDot };
}

export function ProgressTimeline({ events, active, label, compact = false }: {
  events: RecruitmentProgress["events"];
  active: boolean;
  label: string;
  compact?: boolean;
}) {
  const steps = compact ? visibleProgressSteps(events) : allProgressSteps(events);
  const olderSteps = compact ? allProgressSteps(events).slice(0, -steps.length) : [];
  const renderRows = (rows: RecruitmentProgress["events"], offset: number) => <ol className="space-y-1" aria-label={label}>
    {rows.map((event, index) => {
      const current = offset + index === allProgressSteps(events).length - 1;
      const isActive = current && active && event.status === "started";
      const state = eventPresentation(event, isActive);
      const Icon = state.Icon;
      const repeatLabel = event.occurrence > 1 ? `第 ${event.occurrence} 次` : null;
      const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt));
      return <li key={`${event.stage}:${event.occurrence}`} aria-current={isActive ? "step" : undefined}>
        <details className={`group rounded-xl border transition-colors ${isActive ? "border-primary/25 bg-primary/[0.035]" : "border-transparent hover:border-border hover:bg-muted/60"}`}>
          <summary aria-live={isActive ? "polite" : undefined} className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full border ${state.className}`} aria-hidden="true"><Icon className={`size-3.5 ${isActive ? "motion-safe:animate-spin" : ""}`} /></span>
            <span className="min-w-0 flex-1 break-words text-sm leading-5 text-foreground">{progressMessageForUser(event.stage, event.message, event.status)}</span>
            <Badge variant="outline" className={`shrink-0 whitespace-nowrap ${state.className}`}>{state.label}</Badge>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="ml-10 mr-3 border-t border-border/70 px-1 pb-3 pt-2 text-xs leading-5 text-muted-foreground">
            <p className="m-0 break-words text-foreground/80">{event.message}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><time dateTime={event.occurredAt}>记录于 {time}</time>{repeatLabel && <span>{repeatLabel}</span>}</div>
          </div>
        </details>
      </li>;
    })}
  </ol>;
  return <div className="space-y-2">
    {olderSteps.length > 0 && <details className="group rounded-lg border border-dashed px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden"><span>更早的调查步骤 · {olderSteps.length}</span><ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
      <div className="mt-2 border-t pt-2">{renderRows(olderSteps, 0)}</div>
    </details>}
    {renderRows(steps, olderSteps.length)}
  </div>;
}

export function RecruitmentProgressCard({
  progress,
  candidatesPreview,
  progressConnection,
  pendingTurnRequest,
  elapsedSeconds,
  cancellingRequestId,
  onCancel,
  onResumeReanalysis,
}: {
  progress: RecruitmentProgress | null;
  candidatesPreview: RecruitmentCandidatePreview[];
  progressConnection: ProgressConnection;
  pendingTurnRequest: PendingTurnRequest;
  elapsedSeconds: number;
  cancellingRequestId: string | null;
  onCancel: () => void;
  onResumeReanalysis: () => void;
}) {
  const stopped = progress?.stage === "cancelled";
  const cancelling = cancellingRequestId === pendingTurnRequest.requestId || progress?.stage === "cancelling";
  const failed = progress?.stage === "failed";
  const activeMessage = progress
    ? progressMessageForUser(progress.stage, progress.message, progress.events.at(-1)?.status ?? "started")
    : "正在准备本轮调查";
  const statusHint = progress?.stage === "cancelling"
    ? "正在确认调查已停止。"
    : stopped
      ? "本轮调查已停止。"
      : pendingTurnRequest.outcomeUnknown
        ? progressConnection === "live" ? "已重新连接；恢复结果不会重复启动调查。" : progressConnection === "incompatible" ? "暂时无法读取这轮进度。请保留原输入，服务恢复后再查看。" : progressConnection === "stale" ? "进度连接中断，正在确认本轮结果。" : "正在确认本轮状态；请保留原输入。"
        : progressConnection === "incompatible" ? "实时步骤暂不可用，本轮仍在继续。"
          : progressConnection === "stale" ? "阶段更新暂不可用，调查仍在继续。"
            : progressConnection === "live" ? "实时显示本轮已执行的调查步骤。"
              : "正在连接实时进度；等待时间会持续更新。";
  const lastUpdateSeconds = progress ? Math.max(0, Math.round((Date.now() - Date.parse(progress.updatedAt)) / 1000)) : null;
  const showQuietHint = progress?.active === true && !cancelling && lastUpdateSeconds !== null && lastUpdateSeconds >= 20;

  return <Card className="ml-0 gap-0 overflow-hidden border-primary/20 bg-card py-0 shadow-sm sm:ml-9">
    <CardContent className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2" role="status" aria-live="polite" aria-atomic="true">
        <Badge variant="outline" className={`gap-1.5 ${stopped ? "border-border bg-muted text-muted-foreground" : failed ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5 text-primary"}`}>
          <span className={`size-1.5 rounded-full ${stopped ? "bg-muted-foreground" : failed ? "bg-destructive" : "bg-primary"}`} aria-hidden="true" />{stopped ? "已停止" : cancelling ? "正在停止" : failed ? "本轮暂未完成" : pendingTurnRequest.outcomeUnknown ? "正在确认结果" : "调查进行中"}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">已用时 {elapsedLabel(elapsedSeconds)}</span>
      </div>
      {!(progress?.events.length) && <p className="m-0 text-sm font-medium leading-6 text-foreground">{activeMessage}</p>}
      <ProgressTimeline events={progress?.events ?? []} active={progress?.active ?? false} compact label="本轮调查各阶段状态" />
      {showQuietHint && <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">这一步仍在执行，暂时没有新的阶段事件；已等待 {lastUpdateSeconds} 秒。连接仍保持心跳，不需要重复发送需求。</p>}
      {candidatesPreview.length > 0 && progress?.active && <div className="space-y-1.5 border-t border-border/80 pt-3">
        <p className="m-0 text-xs font-medium text-muted-foreground">已发现候选 · {candidatesPreview.length}</p>
        <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
          {candidatesPreview.map((candidate) => <li key={candidate.playerId} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="min-w-0 truncate font-medium text-foreground"><bdi>{candidate.name}</bdi></span>
            <span className="shrink-0 text-muted-foreground">{candidate.team} · {candidate.minutes}′</span>
          </li>)}
        </ul>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-3 text-xs text-muted-foreground">
        <span>{progressStepCountLabel(progress?.events ?? [])} · {progressConnection === "live" ? "实时更新" : "状态同步中"}</span>
        <span className="min-w-0 flex-1 text-right leading-5">{statusHint}</span>
      </div>
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
