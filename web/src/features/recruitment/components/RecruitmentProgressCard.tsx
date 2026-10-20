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
    asking_user: "正在整理需要你确认的问题", completed: "本轮调查已完成", cancelling: "正在结束本轮调查", cancelled: "本轮调查已停止", service_draining: "服务正在安全停止，案件已保存，可稍后继续", failed: "本轮调查暂未完成",
  };
  return stageMessages[stage] ?? message;
}

const stageGuidance: Record<RecruitmentProgress["stage"], string> = {
  understanding: "整理位置、年龄、赛事和能力重点；会影响名单的关键信息不明确时会先向你确认。",
  reference_identity: "先核对参考球员身份，再决定如何将他用于对照或从候选中排除。",
  starting: "正在载入这项案件的调查状态，并准备本轮需求。",
  planning: "结合你确认的条件和已经收集的证据，安排下一步调查。",
  methodology: "查找角色与评估方法资料；方法资料不会被当作球员表现证据。",
  team_sample: "查看目标球队现有的球员样本，确认当前资料能覆盖什么范围。",
  player_detail: "核对候选的位置、赛季和近期表现记录。",
  match_detail: "读取具体比赛记录，为表现判断补充可核对的样本。",
  candidate_search: "按当前已确认的筛选条件查找候选；来源未覆盖的条件会继续标明。",
  player_evaluation: "比较本次关注能力的可用指标；缺失数据会保留为未知。",
  external_signal: "补充独立的整体表现参考，不把它当作战术能力评分。",
  historical_archive: "核对可精确关联的历史赛季样本，不把旧数据当作当前表现。",
  report_search: "查找可追溯的观察资料，用作定性线索而不是统计结论。",
  synthesizing: "汇总候选、实际证据和仍待核实的部分。",
  review: "逐项核对推荐是否有本轮调查证据支持；证据不足时会补查或收窄结论。",
  team_roster_context: "补充公开球队名单作为背景信息，不用于球员评分或候选排序。",
  asking_user: "整理需要你确认的信息；答复后会从同一项调查继续。",
  completed: "本轮调查已经完成。",
  cancelling: "正在安全结束本轮调查，并确认已保存的案件状态。",
  cancelled: "本轮调查已停止。",
  service_draining: "服务正在安全停止；本轮状态已保存，服务恢复后可以继续。",
  failed: "本轮调查暂未完成；已保留安全的失败状态，之后可以重试。",
};

function eventPresentation(event: RecruitmentProgress["events"][number], active: boolean) {
  if (event.status === "failed") return { label: "未完成", className: "border-destructive/20 bg-destructive/5 text-destructive", Icon: CircleX };
  if (event.status === "notice") return { label: "需要留意", className: "border-warning/50 bg-warning/10 text-warning", Icon: TriangleAlert };
  if (event.status === "cancelled") return { label: "已停止", className: "border-border bg-muted text-muted-foreground", Icon: CircleX };
  if (event.status === "waiting_for_user") return { label: "等待补充", className: "border-warning/50 bg-warning/10 text-warning", Icon: CircleHelp };
  if (event.status === "completed") return { label: "已完成", className: "border-primary/20 bg-secondary text-primary", Icon: Check };
  return active
    ? { label: "进行中", className: "border-primary/30 bg-secondary text-primary", Icon: LoaderCircle }
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
  const renderRows = (rows: RecruitmentProgress["events"], offset: number) => <ol className="space-y-1 border-s border-primary/20 ps-3" aria-label={label}>
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
            <span className={`grid size-7 shrink-0 place-items-center rounded-full border ${state.className}`} aria-hidden="true"><Icon className="size-3.5" /></span>
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
  const activeStage = progress?.stage ?? "starting";
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

  return <Card className="ml-0 gap-0 overflow-hidden border-primary/20 bg-card py-0 shadow-[0_18px_54px_-42px_rgba(0,0,0,0.8)] sm:ml-9">
    <CardContent className="space-y-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Badge role="status" aria-live="polite" aria-atomic="true" variant="outline" className={`gap-1.5 ${stopped ? "border-border bg-muted text-muted-foreground" : failed ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/30 bg-secondary text-primary"}`}>
          <span className={`size-1.5 rounded-full ${stopped ? "bg-muted-foreground" : failed ? "bg-destructive" : "bg-primary"}`} aria-hidden="true" />{stopped ? "已停止" : cancelling ? "正在停止" : failed ? "本轮暂未完成" : pendingTurnRequest.outcomeUnknown ? "正在确认结果" : "调查进行中"}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">已用时 {elapsedLabel(elapsedSeconds)}</span>
      </div>
      <section className="flex gap-3 rounded-xl border border-primary/30 bg-secondary/65 p-3.5 sm:p-4" aria-label="当前调查环节">
        <span className="relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
          {!stopped && !failed && !cancelling && <span className="absolute inset-0 rounded-full border border-primary/20" />}
          {stopped || failed ? <CircleX className="size-4" /> : cancelling ? <CircleDot className="size-4" /> : <LoaderCircle className="size-4" />}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary/80">{pendingTurnRequest.outcomeUnknown ? "恢复状态" : cancelling ? "正在停止" : stopped ? "调查已停止" : failed ? "需要重试" : "当前环节"}</p>
          <p className="m-0 break-words text-sm font-semibold leading-5 text-foreground">{pendingTurnRequest.outcomeUnknown ? "正在确认本轮结果" : activeMessage}</p>
          <p className="m-0 text-xs leading-5 text-muted-foreground">{pendingTurnRequest.outcomeUnknown
            ? "恢复时会复用原请求和案件状态，不会另起一轮调查。"
            : cancelling
              ? "正在确认本轮已经停止，并保存可恢复的案件状态。"
              : stopped
                ? "最近一份完整报告仍会保留。"
                : failed
                  ? "调查状态已保留；检查提示后可以重试本轮。"
                  : stageGuidance[activeStage]}</p>
        </div>
      </section>
      <ProgressTimeline events={progress?.events ?? []} active={progress?.active ?? false} compact label="本轮调查各阶段状态" />
      {showQuietHint && <p className="m-0 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">这一步仍在执行，暂时没有新的阶段事件；已等待 {lastUpdateSeconds} 秒。连接仍保持心跳，不需要重复发送需求。</p>}
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
