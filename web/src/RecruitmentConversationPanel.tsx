import { useLayoutEffect, useRef, type FormEvent } from "react";
import { ArrowRight, Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { DeferredTeamSelect } from "./DeferredTeamSelect";
import { ProgressTimeline, RecruitmentProgressCard, progressStepCountLabel, type ProgressConnection } from "./RecruitmentProgressCard";
import type { ConversationMessage } from "./plans";
import type { PendingTurnRequest } from "./turn-requests";
import type { RecruitmentProgress, RecruitmentReport } from "../../src/domain/schemas.js";

export interface RecruitmentConversationView {
  threadId: string;
  activePlanId: string | null;
  messages: ConversationMessage[];
  report: RecruitmentReport | null;
  status: "ready" | "needs_input" | "completed";
  isFreshCase: boolean;
  isActive: boolean;
  waitingForAnswer: boolean;
  turnUnresolved: boolean;
  loading: boolean;
  hasConversationState: boolean;
  pendingTurnRequest: PendingTurnRequest | null;
  progress: RecruitmentProgress | null;
  progressConnection: ProgressConnection;
  elapsedSeconds: number;
  cancellingRequestId: string | null;
  draft: string;
  teamContext: string;
  planName: string;
  userCount: number;
  error: string | null;
  notice: string | null;
}

export interface RecruitmentConversationActions {
  onSendMessage: (messageText?: string, mode?: "normal" | "reanalysis") => void;
  onCancelTurn: () => void;
  onDraftChange: (value: string) => void;
  onTeamContextChange: (value: string) => void;
  onPlanNameChange: (value: string) => void;
}

const suggestedBriefs = [
  "为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋",
  "我想为巴萨找一个新的后卫，要能参与出球和高位防守",
  "给阿森纳找一个能推进、也愿意参与压迫的中场",
];

export function RecruitmentConversationPanel({ view, actions }: {
  view: RecruitmentConversationView;
  actions: RecruitmentConversationActions;
}) {
  const conversationThreadRef = useRef<HTMLDivElement>(null);
  const shouldFollowConversationRef = useRef(true);
  const previousContextRef = useRef({ threadId: view.threadId, activePlanId: view.activePlanId });
  const recoveryRequest = view.pendingTurnRequest?.outcomeUnknown ? view.pendingTurnRequest : null;

  useLayoutEffect(() => {
    if (previousContextRef.current.threadId !== view.threadId || previousContextRef.current.activePlanId !== view.activePlanId) {
      shouldFollowConversationRef.current = true;
      previousContextRef.current = { threadId: view.threadId, activePlanId: view.activePlanId };
    }
    if (!view.isActive || !conversationThreadRef.current || !shouldFollowConversationRef.current) return;
    conversationThreadRef.current.scrollTop = conversationThreadRef.current.scrollHeight;
  }, [view.activePlanId, view.isActive, view.messages.length, view.pendingTurnRequest?.requestId, view.progress?.updatedAt, view.threadId]);

  function sendMessage(messageText?: string, mode?: "normal" | "reanalysis") {
    shouldFollowConversationRef.current = true;
    actions.onSendMessage(messageText, mode);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage();
  }

  return <Card className="gap-0 overflow-hidden py-0" aria-label="球探对话">
    <CardHeader className="flex grid-cols-1 items-center gap-3 border-b px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-primary"><Radar className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <CardTitle className="text-sm">球探对话</CardTitle>
          {!view.isFreshCase && <input aria-label="招募计划名称" className="mt-1 w-full max-w-56 bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" value={view.planName} onChange={(event) => actions.onPlanNameChange(event.target.value)} placeholder={view.activePlanId ? "已保存的招募计划" : "计划名称（可选）"} disabled={view.turnUnresolved} />}
        </div>
      </div>
      {view.activePlanId && view.report && view.status === "completed" && <Button type="button" variant="outline" size="sm" onClick={() => sendMessage("重新分析招募需求", "reanalysis")} disabled={view.turnUnresolved}>重新分析</Button>}
    </CardHeader>

    <CardContent className="space-y-4 p-0">
      <div
        className="max-h-[52dvh] min-h-56 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
        ref={conversationThreadRef}
        onScroll={(event) => {
          const thread = event.currentTarget;
          shouldFollowConversationRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 64;
        }}
      >
        <div className="space-y-4" role="log" aria-live="polite" aria-relevant="additions" aria-label="案件对话消息">
          {view.messages.length === 0 && !view.pendingTurnRequest ? <div className="space-y-5">
            <div>
              <h2 className="max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">用一句话描述引援需求。</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">说出目标球队、想替代的球员或要补强的位置，也可以提预算、年龄和重点能力。缺少会影响搜索的信息时，调查中再向你确认。</p>
            </div>
            <div className="grid gap-2" aria-label="试试这样描述">
              {suggestedBriefs.map((brief) => <button type="button" key={brief} disabled={view.turnUnresolved} onClick={() => actions.onDraftChange(brief)} className="group flex items-start justify-between gap-4 rounded-lg border bg-card px-3.5 py-3 text-left text-sm leading-5 text-foreground transition-colors hover:border-primary/30 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none">
                <span>{brief}</span><ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
              </button>)}
            </div>
          </div> : view.messages.map((message) => {
            const user = message.role === "user";
            return <article className={`flex gap-2.5 ${user ? "justify-end" : "justify-start"}`} key={message.id}>
              {!user && <span className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-primary" aria-label="TactiScout">TS</span>}
              <div className={`min-w-0 max-w-[92%] space-y-2 rounded-xl px-3.5 py-3 text-sm leading-6 sm:max-w-[88%] ${user ? "rounded-br-sm bg-secondary text-foreground" : "rounded-tl-sm bg-muted/70 text-foreground"}`}>
                <p className="m-0 break-words">{message.content}</p>
                {message.teamContext && <Badge variant="outline" className="max-w-full whitespace-normal">目标球队：{message.teamContext}</Badge>}
                {message.questionReason && <div className="space-y-1 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground"><strong className="block font-medium text-foreground">为什么需要确认</strong><span>{message.questionReason}</span></div>}
                {message.progressNotice && <p className="m-0 text-xs leading-5 text-amber-900">{message.progressNotice}</p>}
                {message.progressEvents && message.progressEvents.length > 0 && <details className="group border-t pt-2">
                  <summary className="cursor-pointer list-inside text-xs font-medium text-muted-foreground">查看本轮进度 · {progressStepCountLabel(message.progressEvents)}</summary>
                  <div className="mt-3"><ProgressTimeline events={message.progressEvents} active={false} label="本轮已执行的调查阶段" /></div>
                </details>}
              </div>
            </article>;
          })}
          {(view.loading || view.pendingTurnRequest?.outcomeUnknown) && view.pendingTurnRequest && <article className="flex justify-end" aria-label="本轮已提交的需求">
            <div className="max-w-[92%] space-y-2 rounded-xl rounded-br-sm bg-secondary px-3.5 py-3 text-sm leading-6 sm:max-w-[88%]">
              <p className="m-0 break-words">{view.pendingTurnRequest.displayText}</p>
              {view.pendingTurnRequest.displayTeamContext && <Badge variant="outline">目标球队：{view.pendingTurnRequest.displayTeamContext}</Badge>}
              <p className="m-0 text-xs text-muted-foreground">{view.pendingTurnRequest.outcomeUnknown ? "连接中断，等待恢复本轮结果" : view.pendingTurnRequest.isReanalysis ? "正在重新调查；最近报告仍保留" : "球探正在调查"}</p>
            </div>
          </article>}
        </div>
        {(view.loading || view.pendingTurnRequest?.outcomeUnknown) && view.pendingTurnRequest && <RecruitmentProgressCard
          progress={view.progress}
          progressConnection={view.progressConnection}
          pendingTurnRequest={view.pendingTurnRequest}
          elapsedSeconds={view.elapsedSeconds}
          cancellingRequestId={view.cancellingRequestId}
          onCancel={() => { shouldFollowConversationRef.current = true; actions.onCancelTurn(); }}
          onResumeReanalysis={() => sendMessage("重新分析招募需求", "reanalysis")}
        />}
        {view.waitingForAnswer && !view.loading && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">补充信息后，球探会在同一项引援调查中继续。</p>}
      </div>

      <form className="space-y-3 border-t bg-muted/30 p-4 sm:p-5" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="message-composer">描述招募需求或回答球探问题</label>
        <Textarea id="message-composer" rows={3} className="min-h-28 resize-y bg-background text-sm leading-6 placeholder:text-muted-foreground/80" value={view.draft} onChange={(event) => actions.onDraftChange(event.target.value)} onKeyDown={(event) => {
          const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
          if (event.key === "Enter" && !event.shiftKey && !isComposing) { event.preventDefault(); sendMessage(); }
        }} placeholder={view.waitingForAnswer ? "回答这个问题，或补充你希望优先考虑的方向…" : "例如：为拜仁找凯恩的替代者，优先看接应、做球和射门终结。"} disabled={view.turnUnresolved} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 space-y-1.5 sm:flex-1">
            <label id="team-context-label" htmlFor="team-context" className="text-xs font-medium text-muted-foreground">可选：指定目标球队</label>
            <DeferredTeamSelect id="team-context" value={view.teamContext} onChange={actions.onTeamContextChange} required={false} disabled={view.turnUnresolved} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:items-end">
            <span className="text-center text-[11px] text-muted-foreground sm:text-right">Enter 发送 · Shift + Enter 换行</span>
            <Button className="w-full justify-between gap-4 sm:w-auto" type={recoveryRequest ? "button" : "submit"} disabled={view.loading || (!recoveryRequest && (view.turnUnresolved || !view.draft.trim()))} onClick={recoveryRequest ? () => sendMessage(recoveryRequest.displayText, recoveryRequest.isReanalysis ? "reanalysis" : "normal") : undefined}>
              <span>{view.loading ? "调查中…" : recoveryRequest ? "恢复本轮结果" : view.waitingForAnswer ? "回答并继续" : view.hasConversationState ? "继续调查" : "开始调查"}</span><ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        {view.error && <p className="m-0 text-sm text-destructive" role="alert">{view.error}</p>}
        {view.notice && <p className="m-0 text-sm text-primary" role="status">{view.notice}</p>}
        <p className="m-0 text-xs leading-5 text-muted-foreground">{view.isFreshCase ? "无需填写表格。球探会根据实际数据说明依据与未知项。" : `已进行 ${view.userCount} 轮对话，当前结果可保存为计划。`}</p>
      </form>
    </CardContent>
  </Card>;
}
