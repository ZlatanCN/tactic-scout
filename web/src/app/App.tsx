import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowUpRight, Database, MoreHorizontal, PanelRightClose, PanelRightOpen, Save } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Separator } from "@/shared/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ProductHeader } from "@/shared/ui/product-header";
import { ApiServiceUnavailableError, getDatasetStatus } from "../features/recruitment/lib/api";
import { RecruitmentReportPanel, type DatasetConnectionStatus } from "../features/recruitment/components/RecruitmentReportPanel";
import { RecruitmentConversationPanel } from "../features/recruitment/components/RecruitmentConversationPanel";
import { SavedPlansSidebar } from "../features/recruitment/components/SavedPlansSidebar";
import { useRecruitmentSession } from "../features/recruitment/hooks/useRecruitmentSession";
import { type DatasetStatus } from "../../../src/domain/datasets.js";

const PlayerObservationsDialog = lazy(() => import("../features/recruitment/components/PlayerObservationsDialog").then((module) => ({ default: module.PlayerObservationsDialog })));
const RecruitmentPreferencesDialog = lazy(() => import("../features/recruitment/components/RecruitmentPreferencesDialog").then((module) => ({ default: module.RecruitmentPreferencesDialog })));

function App() {
  const { state, actions } = useRecruitmentSession();
  const [dataset, setDataset] = useState<DatasetStatus | null>(null);
  const [datasetConnectionStatus, setDatasetConnectionStatus] = useState<DatasetConnectionStatus>("connecting");
  const [playerObservationsOpen, setPlayerObservationsOpen] = useState(false);
  const [recruitmentPreferencesOpen, setRecruitmentPreferencesOpen] = useState(false);
  const [reportPaneCollapsed, setReportPaneCollapsed] = useState(false);

  async function refreshDatasetStatus() {
    setDatasetConnectionStatus("connecting");
    try {
      setDataset(await getDatasetStatus());
      setDatasetConnectionStatus("connected");
    } catch (error) {
      setDataset(null);
      setDatasetConnectionStatus(error instanceof TypeError || error instanceof ApiServiceUnavailableError ? "disconnected" : "unavailable");
    }
  }

  useEffect(() => { void refreshDatasetStatus(); }, []);

  const datasetLabel = dataset?.mode === "statsbomb"
    ? "StatsBomb Open Data"
    : dataset?.source
      ?? (datasetConnectionStatus === "connecting" ? "正在连接球探服务" : datasetConnectionStatus === "disconnected" ? "服务端未连接" : "数据状态不可用");
  const datasetConnectionLabel = datasetConnectionStatus === "connected"
    ? "球员资料已就绪"
    : datasetConnectionStatus === "connecting"
      ? "正在连接球探服务"
      : datasetConnectionStatus === "disconnected"
        ? "球探服务未连接"
        : "数据状态不可用";
  const datasetConnectionShortLabel = datasetConnectionStatus === "connected"
    ? "资料就绪"
    : datasetConnectionStatus === "connecting"
      ? "连接中"
      : datasetConnectionStatus === "disconnected"
        ? "未连接"
        : "不可用";
  const isLiveSource = ["sportmonks", "fbref", "fpl", "premier_league", "asa", "understat"].includes(dataset?.mode ?? "");
  const connectionBadgeClass = datasetConnectionStatus === "connected" && isLiveSource
    ? "border-primary/20 bg-secondary text-primary"
    : datasetConnectionStatus === "disconnected" || datasetConnectionStatus === "unavailable"
      ? "border-destructive/20 bg-destructive/5 text-destructive"
      : "border-border bg-muted text-muted-foreground";
  const reportPanelView = state.report
    ? {
      kind: "report" as const,
      report: state.report,
      teamRosterContext: state.teamRosterContext,
      reportedAt: state.reportAt,
      status: state.turnUnresolved ? state.pendingTurnRequest?.isReanalysis ? "refreshing" as const : "updating" as const : state.waitingForAnswer ? "waiting" as const : "complete" as const,
      snapshot: dataset?.snapshot ?? null,
    }
    : {
      kind: "empty" as const,
      dataset,
      datasetLabel,
      connectionStatus: datasetConnectionStatus,
      caseStatus: state.turnUnresolved ? "researching" as const : state.waitingForAnswer ? "waiting" as const : state.error || state.messages.length ? "unfinished" as const : "ready" as const,
    };
  const showPlansSidebar = !state.isFreshCase || state.plans.length > 0;

  return <div className="min-h-screen bg-background">
    <ProductHeader page="workbench" rightContent={<>
      <Badge variant="outline" className={`min-w-0 max-w-[28vw] gap-1.5 truncate px-2.5 py-1 text-xs font-normal sm:max-w-none ${connectionBadgeClass}`}>
        <Database className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate sm:hidden">{datasetConnectionShortLabel}</span><span className="hidden truncate sm:inline">{datasetConnectionLabel}</span>
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="打开工具与资料菜单" />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48 overscroll-contain">
          <DropdownMenuItem onClick={() => setRecruitmentPreferencesOpen(true)}>长期偏好</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPlayerObservationsOpen(true)}>球探观察</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { window.location.href = "/review"; }}>短名单盲评</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { window.location.href = "/adjudicate"; }}>质量评估</DropdownMenuItem>
          <DropdownMenuItem onClick={() => { window.location.href = "/showcase"; }}>查看运行示例</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>} />

    <main id="main-content" className="mx-auto grid max-w-[1800px] grid-cols-1 gap-6 px-4 py-6 sm:px-8 sm:py-8 xl:grid-cols-[220px_minmax(0,1fr)] xl:gap-7 xl:py-8">
      {showPlansSidebar && <aside className="min-w-0">
        <div className="space-y-5 xl:sticky xl:top-24">
          <SavedPlansSidebar plans={state.plans} activePlanId={state.activePlanId} disabled={state.turnUnresolved} onOpen={actions.openPlan} onDelete={actions.deletePlan} onNew={actions.startNewCase} />
          <Separator />
          <p className="m-0 text-xs leading-5 text-muted-foreground">计划与报告保存在此浏览器。</p>
          <a href="/showcase" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">看看一次完整的球探调查<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
        </div>
      </aside>}

      <section id="workbench-task" tabIndex={-1} className={`min-w-0 outline-none ${state.isFreshCase ? showPlansSidebar ? "mx-auto w-full max-w-4xl" : "mx-auto w-full max-w-4xl xl:col-span-2" : ""}`}>
        <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="m-0 break-words text-[1.8rem] font-semibold tracking-[-0.025em] sm:text-[2rem]">{state.isFreshCase ? "从球场问题开始" : state.planName || "招募调查"}</h1>
            <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{state.isFreshCase ? "描述你要补强的位置或球员特点；需要更多信息时，球探会在调查中向你确认。" : state.turnUnresolved ? state.report ? "调查正在继续，上一份报告仍可查看。" : "正在根据你的需求寻找候选球员。" : state.waitingForAnswer ? "回答球探的问题，继续这项调查。" : state.report ? "候选报告会保留在旁边，方便你边看证据边调整需求。" : "在对话中继续补充球队与球员需求。"}</p>
          </div>
          {!state.isFreshCase && <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="sm:hidden" onClick={actions.startNewCase} disabled={state.turnUnresolved}>新建计划</Button>
            <Button type="button" variant="outline" size="sm" onClick={actions.saveCurrentPlan} disabled={state.turnUnresolved || !state.messages.length}><Save aria-hidden="true" />保存计划</Button>
            {!reportPaneCollapsed && <Button type="button" variant="outline" size="sm" className="hidden xl:inline-flex" aria-expanded="true" aria-controls="report-panel" onClick={() => setReportPaneCollapsed(true)}><PanelRightClose aria-hidden="true" />收起报告</Button>}
            {!(state.report && state.workspaceView === "report") && <Badge variant="secondary" className={`h-7 px-2.5 text-xs ${state.turnUnresolved ? "bg-warning/15 text-warning" : ""}`}>{state.turnUnresolved ? "调查中" : state.waitingForAnswer ? "等待回答" : state.report ? "最近报告可查看" : "待继续"}</Badge>}
          </div>}
        </div>

        {!state.isFreshCase && <Tabs value={state.workspaceView} onValueChange={(value) => { if (value === "conversation" || value === "report") actions.setWorkspaceView(value); }} className="mb-5 xl:hidden">
          <TabsList className="grid h-11 w-full max-w-md grid-cols-2 bg-muted p-1">
            <TabsTrigger value="conversation">球探对话{state.waitingForAnswer ? " · 需要回答" : ""}</TabsTrigger>
            <TabsTrigger value="report">候选报告{state.report ? ` · ${state.report.recommendations.length}` : ""}</TabsTrigger>
          </TabsList>
        </Tabs>}

        <div className={`grid min-w-0 grid-cols-1 gap-5 ${state.isFreshCase ? "" : reportPaneCollapsed ? "xl:grid-cols-[minmax(0,1fr)_3rem] xl:items-start xl:gap-3" : "xl:grid-cols-[minmax(19rem,0.88fr)_minmax(21rem,1.12fr)] xl:items-start xl:gap-6"}`}>
          <div className={`min-w-0 xl:sticky xl:top-20 xl:self-start ${state.isFreshCase || state.workspaceView === "conversation" ? "block" : "hidden xl:block"}`}>
            <RecruitmentConversationPanel
              view={{
                threadId: state.threadId, activePlanId: state.activePlanId, messages: state.messages, report: state.report, status: state.status,
                isFreshCase: state.isFreshCase, isActive: state.workspaceView === "conversation", waitingForAnswer: state.waitingForAnswer,
                turnUnresolved: state.turnUnresolved, loading: state.loading, hasConversationState: state.hasConversationState,
                pendingTurnRequest: state.pendingTurnRequest, progress: state.progress, candidatesPreview: state.candidatesPreview, progressConnection: state.progressConnection,
                elapsedSeconds: state.elapsedSeconds, cancellingRequestId: state.cancellingRequestId, draft: state.draft,
                teamContext: state.teamContext, planName: state.planName, userCount: state.userCount, error: state.error, notice: state.notice,
              }}
              actions={{
                onSendMessage: (messageText, mode, positionAnswer, playerIdentityAnswer) => { void actions.sendMessage(messageText ?? state.draft, mode ?? "normal", positionAnswer, undefined, playerIdentityAnswer); },
                onUpdatePositions: (positions) => { void actions.sendMessage("修改招募位置，按新选择重新调查", "normal", undefined, positions); },
                onCancelTurn: () => { void actions.cancelCurrentTurn(); }, onDraftChange: actions.setDraft,
                onTeamContextChange: actions.setTeamContext, onPlanNameChange: actions.setPlanName,
              }}
            />
          </div>

          <div id="report-panel" className={`min-w-0 ${state.isFreshCase ? "hidden" : state.workspaceView === "report" ? "block" : "hidden xl:block"} ${reportPaneCollapsed ? "xl:hidden" : ""}`}>
            {!state.isFreshCase && <RecruitmentReportPanel view={reportPanelView} onAction={(action) => {
              if (action === "retry_dataset") void refreshDatasetStatus();
              else setPlayerObservationsOpen(true);
            }} />}
          </div>
          {!state.isFreshCase && reportPaneCollapsed && <div className="hidden xl:flex xl:justify-center">
            <Button type="button" variant="outline" size="icon-lg" className="h-auto min-h-32 flex-col gap-3 py-4" aria-label="展开报告与证据" aria-expanded="false" aria-controls="report-panel" onClick={() => setReportPaneCollapsed(false)}>
              <PanelRightOpen aria-hidden="true" /><span className="[writing-mode:vertical-rl]">报告与证据</span>
            </Button>
          </div>}
        </div>

        {state.isFreshCase && <div className="mt-4 space-y-3 text-xs leading-5 text-muted-foreground">
          <details className="group rounded-lg border bg-card px-4 py-3">
            <summary className="cursor-pointer font-medium text-foreground">当前数据与分析范围</summary>
            <p className="mb-0 mt-2">{datasetLabel}。报告会记录实际读取的赛事、赛季和比赛样本；未提供的信息会保留为未知。</p>
          </details>
          {(datasetConnectionStatus === "disconnected" || datasetConnectionStatus === "unavailable") && <p role="status" className="m-0 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-destructive">
            球探服务暂不可用。<button type="button" className="ml-1 underline underline-offset-4" onClick={() => void refreshDatasetStatus()}>重试连接</button>
          </p>}
        </div>}
      </section>
    </main>

    {playerObservationsOpen && <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-background/70 text-sm text-muted-foreground" role="status">正在打开球探观察…</div>}><PlayerObservationsDialog onClose={() => setPlayerObservationsOpen(false)} /></Suspense>}
    {recruitmentPreferencesOpen && <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-background/70 text-sm text-muted-foreground" role="status">正在打开长期偏好…</div>}><RecruitmentPreferencesDialog onClose={() => setRecruitmentPreferencesOpen(false)} /></Suspense>}
    <footer className="mx-auto flex max-w-[1800px] flex-col gap-1 border-t border-border/80 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <span className="font-medium text-foreground">TactiScout</span><span>每个建议，都有依据可查。</span>
    </footer>
  </div>;
}

export default App;
