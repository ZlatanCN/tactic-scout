import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ApiContractError, ApiServiceUnavailableError, cancelRecruitmentTurn, getDatasetStatus, getRecruitmentProgress, turnRecruitmentCase } from "./api";
import { SearchableTeamSelect } from "./SearchableTeamSelect";
import { PlayerObservationsDialog } from "./PlayerObservationsDialog";
import { RecruitmentReportPanel, type DatasetConnectionStatus } from "./RecruitmentReportPanel";
import { formatDate } from "./format-date";
import { allProgressSteps, visibleProgressSteps } from "./progress";
import { isTurnUnresolved, resolveTurnRequest, type PendingTurnRequest } from "./turn-requests";
import {
  createFreshReanalysisMessage,
  createFreshReanalysisTurn,
  loadRecruitmentPlans,
  messageFromTurn,
  removeRecruitmentPlan,
  saveRecruitmentPlans,
  upsertRecruitmentPlan,
  type ConversationMessage,
  type SavedRecruitmentPlan,
} from "./plans";
import type { DatasetStatus, RecruitmentProgress, RecruitmentReport, TeamRosterContext } from "../../src/domain/schemas.js";

const suggestedBriefs = [
  "为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋",
  "我想为巴萨找一个新的后卫，要能参与出球和高位防守",
  "给阿森纳找一个能推进、也愿意参与压迫的中场",
];

function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function describeTurnError(error: unknown): string {
  if (!(error instanceof Error)) return "对话暂时无法继续，请稍后再试。你输入的内容还在。";
  if (/connection error|econnrefused|fetch failed/i.test(error.message)) {
    return "无法连接当前配置的模型服务。若使用 Ollama，请确认它正在运行，并检查模型服务配置后重试；你的需求已保留。";
  }
  return error.message;
}

function progressStepCountLabel(events: RecruitmentProgress["events"]): string {
  return `${allProgressSteps(events).length} 步`;
}

function ProgressTimeline({ events, active, label, compact = false }: {
  events: RecruitmentProgress["events"];
  active: boolean;
  label: string;
  compact?: boolean;
}) {
  const steps = compact ? visibleProgressSteps(events) : allProgressSteps(events);
  return <ol className="recruitment-progress-timeline" aria-label={label}>
    {steps.map((event, index) => {
      const current = index === steps.length - 1;
      const activeEvent = current && active && event.status === "started";
      const repeatLabel = event.occurrence > 1 ? `第 ${event.occurrence} 次` : null;
      const statusLabel = event.status === "completed"
        ? "已完成"
        : event.status === "waiting_for_user"
          ? "等待补充"
          : event.status === "notice"
            ? "需要留意"
            : event.status === "failed"
              ? "未完成"
              : event.status === "cancelled"
                ? "已停止"
              : activeEvent ? "进行中" : "已开始";
      return <li className={activeEvent ? "is-current" : event.status === "failed" || event.status === "notice" ? "is-notice" : event.status === "cancelled" ? "is-cancelled" : "is-history"} key={`${event.stage}:${event.occurrence}`} aria-current={activeEvent ? "step" : undefined}>
        <span className="recruitment-progress-marker" aria-hidden="true">{event.status === "completed" ? "✓" : event.status === "failed" ? "!" : event.status === "cancelled" ? "×" : ""}</span>
        <span className="recruitment-progress-event">
          <span className="recruitment-progress-event-meta">{statusLabel}{repeatLabel && <small>{repeatLabel}</small>}</span>
          <span className="recruitment-progress-event-label">{event.message}</span>
        </span>
      </li>;
    })}
  </ol>;
}

function App() {
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [report, setReport] = useState<RecruitmentReport | null>(null);
  const [teamRosterContext, setTeamRosterContext] = useState<TeamRosterContext | null>(null);
  const [reportAt, setReportAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"ready" | "needs_input" | "completed">("ready");
  const [draft, setDraft] = useState("");
  const [teamContext, setTeamContext] = useState("");
  const [planName, setPlanName] = useState("");
  const [originalBrief, setOriginalBrief] = useState("");
  const [dataset, setDataset] = useState<DatasetStatus | null>(null);
  const [datasetConnectionStatus, setDatasetConnectionStatus] = useState<DatasetConnectionStatus>("connecting");
  const [plans, setPlans] = useState<SavedRecruitmentPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [hasConversationState, setHasConversationState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [pendingTurnRequest, setPendingTurnRequest] = useState<PendingTurnRequest | null>(null);
  const [progress, setProgress] = useState<RecruitmentProgress | null>(null);
  const [progressConnection, setProgressConnection] = useState<"idle" | "connecting" | "live" | "stale" | "incompatible">("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerObservationsOpen, setPlayerObservationsOpen] = useState(false);
  const conversationThreadRef = useRef<HTMLDivElement>(null);
  const shouldFollowConversationRef = useRef(true);

  useLayoutEffect(() => {
    const conversationThread = conversationThreadRef.current;
    if (!conversationThread || !shouldFollowConversationRef.current) return;
    conversationThread.scrollTop = conversationThread.scrollHeight;
  }, [activePlanId, messages.length, pendingTurnRequest?.requestId, progress?.updatedAt, threadId]);

  async function refreshDatasetStatus() {
    setDatasetConnectionStatus("connecting");
    try {
      const currentDataset = await getDatasetStatus();
      setDataset(currentDataset);
      setDatasetConnectionStatus("connected");
    } catch (caught) {
      setDataset(null);
      setDatasetConnectionStatus(caught instanceof TypeError || caught instanceof ApiServiceUnavailableError ? "disconnected" : "unavailable");
    }
  }

  useEffect(() => {
    void refreshDatasetStatus();
    try {
      setPlans(loadRecruitmentPlans());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "本地计划无法读取。");
    }
  }, []);

  const datasetLabel = dataset?.mode === "statsbomb"
    ? "StatsBomb Open Data"
    : dataset?.source
      ?? (datasetConnectionStatus === "connecting" ? "正在连接球探服务" : datasetConnectionStatus === "disconnected" ? "服务端未连接" : "数据状态不可用");
  const waitingForAnswer = status === "needs_input";
  const turnUnresolved = isTurnUnresolved(loading, pendingTurnRequest);

  useEffect(() => {
    const recoveringTurn = pendingTurnRequest?.outcomeUnknown === true;
    if ((!loading && !recoveringTurn) || startedAt === null || !pendingTurnRequest) return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const elapsedTimer = window.setInterval(updateElapsed, 1000);
    let cancelled = false;
    let consecutiveProgressFailures = 0;
    let pollTimer: number | undefined;
    const pollProgress = async () => {
      try {
        const current = await getRecruitmentProgress(pendingTurnRequest.caseId, pendingTurnRequest.requestId);
        if (!cancelled) {
          consecutiveProgressFailures = 0;
          setProgress(current);
          setProgressConnection("live");
        }
      } catch (caught) {
        consecutiveProgressFailures += 1;
        if (!cancelled) {
          if (caught instanceof ApiContractError) setProgressConnection("incompatible");
          else setProgressConnection((previous) => previous === "incompatible"
            ? "incompatible"
            : previous === "live" || previous === "stale" || consecutiveProgressFailures >= 5
              ? "stale"
              : "connecting");
        }
      }
      if (!cancelled) pollTimer = window.setTimeout(() => void pollProgress(), 1200);
    };
    void pollProgress();
    return () => {
      cancelled = true;
      window.clearInterval(elapsedTimer);
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [loading, pendingTurnRequest?.caseId, pendingTurnRequest?.outcomeUnknown, pendingTurnRequest?.requestId, startedAt]);

  function persistPlans(nextPlans: SavedRecruitmentPlan[], successMessage?: string) {
    try {
      saveRecruitmentPlans(nextPlans);
      setPlans(nextPlans);
      setError(null);
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法保存本地计划。");
      return false;
    }
  }

  function persistCurrentPlan(input: {
    nextMessages: ConversationMessage[];
    nextReport: RecruitmentReport | null;
    nextReportAt: string | null;
    nextHasConversationState: boolean;
    brief: string;
    id: string;
    threadId?: string;
  }): boolean {
    const now = new Date().toISOString();
    const name = planName.trim() || input.brief.trim().slice(0, 42) || "新的招募计划";
    const saved = upsertRecruitmentPlan(plans, {
      id: input.id,
      name,
      threadId: input.threadId ?? threadId,
      originalBrief: input.brief,
      messages: input.nextMessages,
      currentReport: input.nextReport,
      currentReportedAt: input.nextReportAt,
      hasConversationState: input.nextHasConversationState,
      now,
    });
    if (persistPlans(saved.plans)) {
      setActivePlanId(saved.plan.id);
      setPlanName(saved.plan.name);
      setHasConversationState(input.nextHasConversationState);
      return true;
    }
    return false;
  }

  async function cancelCurrentTurn() {
    const request = pendingTurnRequest;
    if (!request || cancellingRequestId === request.requestId || progress?.stage === "cancelling" || progress?.stage === "cancelled") return;
    setCancellingRequestId(request.requestId);
    setError(null);
    try {
      const result = await cancelRecruitmentTurn(request.caseId, request.requestId);
      if (result.status === "already_settled") {
        setNotice("本轮已经结束，正在恢复它的结果。");
        if (!loading) void sendMessage(request.displayText, request.isReanalysis ? "reanalysis" : "normal");
        return;
      }
      const occurredAt = new Date().toISOString();
      const cancellingEvent: RecruitmentProgress["events"][number] = {
        sequence: (progress?.events.at(-1)?.sequence ?? 0) + 1,
        occurrence: 1,
        stage: "cancelling",
        status: "started",
        message: "已收到停止请求，正在结束本轮调查",
        occurredAt,
      };
      setProgress((current) => current?.requestId === request.requestId ? {
        ...current,
        active: true,
        stage: "cancelling",
        message: "已收到停止请求，正在结束本轮调查",
        updatedAt: occurredAt,
        events: current.events.some((event) => event.stage === "cancelling") ? current.events : [...current.events, cancellingEvent].slice(-24),
      } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "停止请求没有送达；本轮调查仍可能在运行。可稍后重试。");
    } finally {
      setCancellingRequestId(null);
    }
  }

  async function sendMessage(messageText = draft, mode: "normal" | "reanalysis" = "normal") {
    const text = messageText.trim();
    if (!text || loading) return;
    const isReanalysis = mode === "reanalysis";
    const canRecoverReanalysis = isReanalysis && pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.isReanalysis;
    if (isReanalysis && (!activePlanId || !report || (status !== "completed" && !canRecoverReanalysis))) return;
    const displayText = isReanalysis
      ? "重新分析当前招募需求，并按最新可用数据重新搜索候选人。"
      : text;
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayText,
      ...(isReanalysis ? { isReanalysisAction: true } : {}),
      ...(!isReanalysis && teamContext.trim() ? { teamContext: teamContext.trim() } : {}),
    };
    const nextMessages = messages;
    const brief = originalBrief || text;
    let requestMessage: string;
    let expectsExistingState: boolean;
    if (isReanalysis) {
      requestMessage = createFreshReanalysisMessage({ originalBrief: brief, messages });
      expectsExistingState = false;
    } else {
      const contextParts = [text];
      if (teamContext.trim()) contextParts.push(`用户补充的目标球队：${teamContext.trim()}`);
      if (!hasConversationState && messages.length > 0) {
        contextParts.unshift(`案件原始需求：${originalBrief || messages.find((item) => item.role === "user")?.content || "未记录"}`);
        const priorConversation = messages.slice(-12).map((item) => `${item.role === "user" ? "用户" : "Agent"}：${item.content}`).join("\n");
        if (priorConversation) contextParts.unshift(`此前案件对话（用于恢复讨论上下文）：\n${priorConversation}`);
        if (report) contextParts.push(`此前报告摘要：${report.needSummary}`);
      }
      requestMessage = contextParts.join("\n\n");
      expectsExistingState = hasConversationState;
    }
    const requestCaseId = isReanalysis ? crypto.randomUUID() : threadId;
    const turn = isReanalysis
      ? createFreshReanalysisTurn({ caseId: requestCaseId, message: requestMessage })
      : { caseId: requestCaseId, message: requestMessage, expectsExistingState };
    const resolution = resolveTurnRequest({
      requested: {
        ...turn,
        isReanalysis,
        displayText,
        ...(!isReanalysis && teamContext.trim() ? { displayTeamContext: teamContext.trim() } : {}),
      },
      pending: pendingTurnRequest,
      createRequestId: () => crypto.randomUUID(),
    });
    if (resolution.blockedByUnknownOutcome || !resolution.request) {
      setError("上一轮连接中断，结果尚未确认。请先恢复原输入并重新发送，取回结果后再修改需求。");
      return;
    }
    const request = resolution.request;
    shouldFollowConversationRef.current = true;
    if (isReanalysis) {
      setStatus("ready");
    }
    setPendingTurnRequest({ ...request, outcomeUnknown: false });
    if (!isReanalysis) setDraft("");

    const requestStartedAt = Date.now();
    setLoading(true);
    setStartedAt(requestStartedAt);
    setElapsedSeconds(0);
    setProgressConnection("connecting");
    setProgress({
      requestId: request.requestId,
      active: true,
      stage: "starting",
      message: "正在启动本轮球探调查",
      completedSteps: 0,
      updatedAt: new Date(requestStartedAt).toISOString(),
      events: [],
    });
    setError(null);
    setNotice(null);

    try {
      const response = await turnRecruitmentCase(request.caseId, request.message, request.expectsExistingState, request.requestId);
      if (response.status === "cancelled") {
        const assistantMessage = messageFromTurn(response);
        const updatedMessages = [...nextMessages, userMessage, assistantMessage];
        const nextThreadId = isReanalysis ? threadId : crypto.randomUUID();
        const nextHasConversationState = isReanalysis ? hasConversationState : false;
        setMessages(updatedMessages);
        setThreadId(nextThreadId);
        setHasConversationState(nextHasConversationState);
        setStatus(report ? "completed" : "ready");
        setDraft(text);
        setOriginalBrief(brief);
        setPendingTurnRequest(null);
        setProgressConnection("idle");
        setNotice(report
          ? "本轮调查已停止。最近一份完整报告仍保留；输入框中保留了本轮需求，可修改后重新开始。"
          : "本轮调查已停止，尚未生成报告；输入框中保留了本轮需求，可修改后重新开始。");
        if (activePlanId) {
          persistCurrentPlan({
            nextMessages: updatedMessages,
            nextReport: report,
            nextReportAt: reportAt,
            nextHasConversationState,
            brief,
            id: activePlanId,
            threadId: nextThreadId,
          });
        }
        return;
      }
      setCancellingRequestId(null);
      const progressNotice = response.progressEvents?.length
        ? undefined
        : "本轮调查已完成，但当前球探服务没有提供可回看的 LangGraph 阶段记录。结束本轮后重启本地 API 服务，再开始的新调查会显示实际步骤。";
      const assistantMessage = messageFromTurn(response, progressNotice);
      const updatedMessages = [...nextMessages, userMessage, assistantMessage];
      const now = new Date().toISOString();
      const completedReport = response.status === "completed" ? response.report : null;
      const updatedReport = completedReport ?? report;
      const updatedReportAt = completedReport ? now : reportAt;

      setMessages(updatedMessages);
      setReport(updatedReport);
      if (completedReport) setTeamRosterContext(response.teamRosterContext ?? null);
      setReportAt(updatedReportAt);
      setThreadId(request.caseId);
      setStatus(response.status);
      setDraft("");
      setTeamContext("");
      setOriginalBrief(brief);
      setHasConversationState(true);
      setPendingTurnRequest(null);
      setCancellingRequestId(null);

      if (activePlanId) {
        persistCurrentPlan({
          nextMessages: updatedMessages,
          nextReport: updatedReport,
          nextReportAt: updatedReportAt,
          nextHasConversationState: true,
          brief,
          id: activePlanId,
          threadId: request.caseId,
        });
      }
    } catch (caught) {
      if (!isReanalysis) setDraft(text);
      if (caught instanceof TypeError) {
        setPendingTurnRequest({ ...request, outcomeUnknown: true });
        setError("连接中断，本轮结果尚未确认。恢复连接后重发同一条内容可取回结果；服务进程仍运行时，已接收的请求不会重复执行。");
      } else {
        setPendingTurnRequest(null);
        if (isReanalysis) setStatus("completed");
        setError(describeTurnError(caught));
      }
    } finally {
      setLoading(false);
      setCancellingRequestId(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function saveCurrentPlan() {
    if (turnUnresolved) return;
    if (!messages.length) {
      setError("先描述一条招募需求，再保存计划。");
      return;
    }
    const saved = persistCurrentPlan({
      nextMessages: messages,
      nextReport: report,
      nextReportAt: reportAt,
      nextHasConversationState: hasConversationState,
      brief: originalBrief || messages.find((message) => message.role === "user")?.content || "",
      id: activePlanId ?? crypto.randomUUID(),
    });
    if (saved) setNotice(report ? "招募计划和最近报告已保存到此浏览器。" : "招募计划与对话已保存；完成分析后会更新最近报告。");
  }

  function openPlan(plan: SavedRecruitmentPlan) {
    if (turnUnresolved) return;
    shouldFollowConversationRef.current = true;
    setThreadId(plan.threadId);
    setMessages(plan.messages);
    setReport(plan.lastReport);
    setTeamRosterContext(null);
    setReportAt(plan.lastReportedAt);
    setStatus(plan.messages.at(-1)?.questionReason ? "needs_input" : plan.lastReport ? "completed" : "ready");
    setDraft("");
    setTeamContext("");
    setPlanName(plan.name);
    setOriginalBrief(plan.originalBrief);
    setActivePlanId(plan.id);
    setHasConversationState(plan.hasConversationState);
    setError(null);
    setProgress(null);
    setProgressConnection("idle");
    setNotice(plan.lastReportedAt
      ? `已打开计划，显示 ${formatDate(plan.lastReportedAt)} 保存的最近报告。`
      : "已打开保存的招募对话。Agent 会接着处理你的补充。 ");
  }

  function startNewCase() {
    if (turnUnresolved) return;
    shouldFollowConversationRef.current = true;
    setThreadId(crypto.randomUUID());
    setMessages([]);
    setReport(null);
    setTeamRosterContext(null);
    setReportAt(null);
    setStatus("ready");
    setDraft("");
    setTeamContext("");
    setPlanName("");
    setOriginalBrief("");
    setActivePlanId(null);
    setHasConversationState(false);
    setError(null);
    setNotice("已开始新的招募案件。");
    setProgress(null);
    setProgressConnection("idle");
  }

  function deletePlan(id: string) {
    if (turnUnresolved) return;
    const plan = plans.find((item) => item.id === id);
    if (!plan || !window.confirm(`确定删除“${plan.name}”吗？`)) return;
    const next = removeRecruitmentPlan(plans, id);
    if (persistPlans(next, "已删除本地计划。") && activePlanId === id) startNewCase();
  }

  const userCount = messages.filter((message) => message.role === "user").length;
  const reportPanelView = report
    ? {
      kind: "report" as const,
      report,
      teamRosterContext,
      reportedAt: reportAt,
      status: waitingForAnswer ? "waiting" as const : pendingTurnRequest?.isReanalysis && (loading || pendingTurnRequest.outcomeUnknown) ? "refreshing" as const : "complete" as const,
      snapshot: dataset?.snapshot ?? null,
    }
    : {
      kind: "empty" as const,
      dataset,
      datasetLabel,
      connectionStatus: datasetConnectionStatus,
    };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="TactiScout 首页">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>TactiScout</span>
        </a>
        <div className="topbar-meta">
          <span className={`source-pill ${dataset?.mode === "sportmonks" || dataset?.mode === "fbref" || dataset?.mode === "fpl" || dataset?.mode === "premier_league" || dataset?.mode === "asa" || dataset?.mode === "understat" ? "source-pill-live" : ""} ${datasetConnectionStatus === "connecting" ? "source-pill-connecting" : ""} ${datasetConnectionStatus === "disconnected" || datasetConnectionStatus === "unavailable" ? "source-pill-unavailable" : ""}`}><span className="status-dot" />{datasetLabel}</span>
          <button type="button" className="text-button observations-open-button" onClick={() => setPlayerObservationsOpen(true)}>球探观察</button>
          <a className="text-button review-open-button" href="/review">短名单盲评</a>
          <a className="text-button review-open-button" href="/adjudicate">质量评估</a>
          <span className="topbar-caption">对话式球探工作台 <span>·</span> MVP</span>
        </div>
      </header>

      <main id="top" className="main-layout conversation-layout">
        <section className="intro-row">
          <div>
            <p className="eyebrow">TACTICAL RECRUITMENT, WITH EVIDENCE</p>
            <h1>把阵容问题交给球探，<em>一起找到答案。</em></h1>
            <p className="intro-copy">用一句话描述需求。Agent 会先调查数据，必要时再向你追问，并说明推荐依据和证据边界。</p>
          </div>
          <a className="showcase-home-link" href="/showcase">
            <span className="showcase-home-icon" aria-hidden="true">↗</span>
            <span><strong>先看一段真实运行</strong><small>免配置 · 无需启动模型</small></span>
            <span className="showcase-home-arrow" aria-hidden="true">→</span>
          </a>
        </section>

        <SavedPlans plans={plans} activePlanId={activePlanId} disabled={turnUnresolved} onOpen={openPlan} onDelete={deletePlan} onNew={startNewCase} />

        <div className="conversation-workspace">
          <section className="conversation-panel" aria-label="球探对话">
            <div className="conversation-heading">
              <div className="conversation-heading-title"><span className="section-kicker">01 / CASE</span><input aria-label="招募计划名称" value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder={activePlanId ? "已保存的招募计划" : "计划名称（可选）"} disabled={turnUnresolved} /></div>
              <div className="conversation-heading-actions">
                {activePlanId && report && status === "completed" && <button type="button" className="text-button" onClick={() => void sendMessage("重新分析招募需求", "reanalysis")} disabled={turnUnresolved}>重新分析</button>}
                <button type="button" className="text-button" onClick={saveCurrentPlan} disabled={!messages.length || turnUnresolved}>保存计划</button>
              </div>
            </div>

            <div
              className="conversation-thread"
              ref={conversationThreadRef}
              onScroll={(event) => {
                const thread = event.currentTarget;
                shouldFollowConversationRef.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 64;
              }}
            >
              <div className="conversation-message-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="案件对话消息">
                {messages.length === 0 ? (
                  <div className="conversation-welcome">
                    <span className="assistant-avatar">TS</span>
                    <div className="welcome-card">
                      <strong>你想解决什么阵容问题？</strong>
                      <p>说说球队和你期待的球员特点。不必先填位置、年龄或一长串筛选条件。</p>
                      <div className="suggested-briefs">
                        {suggestedBriefs.map((brief) => <button type="button" key={brief} onClick={() => setDraft(brief)}>{brief}<span aria-hidden="true">↗</span></button>)}
                      </div>
                    </div>
                  </div>
                ) : messages.map((message) => (
                  <article className={`chat-message ${message.role === "user" ? "chat-message-user" : "chat-message-assistant"}`} key={message.id}>
                    {message.role === "assistant" && <span className="assistant-avatar">TS</span>}
                    <div className="chat-bubble">
                      <p>{message.content}</p>
                      {message.teamContext && <span className="chat-context-chip">目标球队：{message.teamContext}</span>}
                      {message.questionReason && <div className="question-reason"><strong>为什么需要确认</strong><span>{message.questionReason}</span></div>}
                      {message.progressNotice && <small className="conversation-progress-warning">{message.progressNotice}</small>}
                      {message.progressEvents && message.progressEvents.length > 0 && <details className="conversation-progress-details">
                        <summary>查看 Agent 实际调查步骤 <span>{progressStepCountLabel(message.progressEvents)}</span></summary>
                        <ProgressTimeline events={message.progressEvents} active={false} label="本轮已执行的调查阶段" />
                      </details>}
                    </div>
                  </article>
                ))}
                {(loading || pendingTurnRequest?.outcomeUnknown) && pendingTurnRequest && <article className="chat-message chat-message-user chat-message-pending" aria-label="本轮已提交的需求">
                  <div className="chat-bubble">
                    <p>{pendingTurnRequest.displayText}</p>
                    {pendingTurnRequest.displayTeamContext && <span className="chat-context-chip">目标球队：{pendingTurnRequest.displayTeamContext}</span>}
                    <small>{pendingTurnRequest.outcomeUnknown ? "等待恢复本轮结果" : pendingTurnRequest.isReanalysis ? "正在全新案件中搜索；最近报告仍保留" : "已提交，Agent 正在处理"}</small>
                  </div>
                </article>}
              </div>
              {(loading || pendingTurnRequest?.outcomeUnknown) && <div className="chat-message chat-message-assistant">
                <span className="assistant-avatar">TS</span>
                <div className="chat-bubble recruitment-progress">
                  <div className="recruitment-progress-heading" role="status" aria-live="polite" aria-atomic="true">
                    <span className={`recruitment-progress-live-dot${progress?.active === false ? " is-settled" : ""}`} aria-hidden="true" />
                    <strong>{progress?.message ?? "正在启动本轮球探调查"}</strong>
                  </div>
                  <ProgressTimeline events={progress?.events ?? []} active={progress?.active ?? false} compact label="本轮调查各阶段状态" />
                  <div className="recruitment-progress-meta"><span>已等待 {elapsedLabel(elapsedSeconds)}</span><span>记录 Agent 实际完成的调查步骤</span></div>
                  <small role="status" aria-live="polite" aria-atomic="true">{progress?.stage === "cancelling"
                    ? "已向本地服务发送停止信号；正在确认本轮结束。"
                    : progress?.stage === "cancelled"
                    ? "本轮调查已停止。"
                    : pendingTurnRequest?.outcomeUnknown
                    ? progressConnection === "live" ? "已恢复本轮阶段；取回本轮结果不会重复启动调查。" : progressConnection === "incompatible" ? "本地 API 返回了旧版阶段数据；请保留原输入，先不要更改这轮需求。" : progressConnection === "stale" ? "阶段更新暂时不可用；连接恢复后可取回本轮结果。" : "正在确认这轮调查的执行状态；请保留原输入。"
                    : progressConnection === "incompatible" ? "本地 API 返回的阶段格式与工作台不匹配；本轮仍在运行，结束后重启 API 服务即可恢复实际步骤显示。"
                      : progressConnection === "stale" ? "阶段更新暂时不可用；本轮仍在继续，计时会保留。"
                        : progressConnection === "live" ? "实时阶段已连接；当前步骤来自 Agent 的实际执行。"
                          : "正在连接实时阶段；等待时间会持续更新。"}</small>
                  {pendingTurnRequest && <button type="button" className="cancel-turn-button" onClick={() => void cancelCurrentTurn()} disabled={cancellingRequestId === pendingTurnRequest.requestId || progress?.stage === "cancelling" || progress?.stage === "cancelled"}>{cancellingRequestId === pendingTurnRequest.requestId || progress?.stage === "cancelling" ? "正在结束本轮…" : progress?.stage === "cancelled" ? "已停止" : "停止调查"}</button>}
                  {pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.isReanalysis && <button type="button" className="text-button recovery-action" onClick={() => void sendMessage("重新分析招募需求", "reanalysis")} disabled={loading}>恢复重新分析</button>}
                  {!pendingTurnRequest?.outcomeUnknown && progress?.stage !== "cancelling" && progress?.stage !== "cancelled" && progressConnection === "live" && elapsedSeconds >= 20 && <small>当前环节仍在处理；完成后会显示本次调查结果。</small>}
                </div>
              </div>}
              {waitingForAnswer && !loading && <p className="turn-hint">补充信息后，Agent 会在同一案件中继续调查。</p>}
            </div>

            <form className="composer" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="message-composer">描述招募需求或回答球探问题</label>
              <textarea id="message-composer" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
                const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
                if (event.key === "Enter" && !event.shiftKey && !isComposing) {
                  event.preventDefault();
                  void sendMessage();
                }
              }} placeholder={waitingForAnswer ? "回答这个问题，或补充你希望优先考虑的方向…" : "例如：为拜仁寻找凯恩的替代者，重点看能接应、做球和终结的前锋"} disabled={turnUnresolved} />
              <div className="composer-bottom">
                <div className="composer-context">
                  <label id="team-context-label" htmlFor="team-context">可选：指定目标球队</label>
                  <SearchableTeamSelect id="team-context" value={teamContext} onChange={setTeamContext} required={false} />
                </div>
                <div className="composer-actions">
                  <span>Enter 发送 <i>·</i> Shift + Enter 换行</span>
                  <button className="submit-button" type="submit" disabled={turnUnresolved || !draft.trim()}><span>{loading ? "研究中…" : waitingForAnswer ? "继续案件" : "开始研究"}</span><span className="button-arrow" aria-hidden="true">→</span></button>
                </div>
              </div>
              {error && <p className="error-message" role="alert">{error}</p>}
              {notice && <p className="plan-message" role="status">{notice}</p>}
            </form>
            <div className="conversation-footnote">已进行 {userCount} 轮用户输入 <span>·</span> 对话与报告可保存到此浏览器</div>
          </section>

          <section className="report-panel" aria-label="球探报告">
            <RecruitmentReportPanel view={reportPanelView} onAction={(action) => {
              if (action === "retry_dataset") void refreshDatasetStatus();
              else setPlayerObservationsOpen(true);
            }} />
          </section>
        </div>
      </main>
      {playerObservationsOpen && <PlayerObservationsDialog onClose={() => setPlayerObservationsOpen(false)} />}
      <footer className="site-footer"><span>TactiScout <b>·</b> Football scouting research prototype</span><span>DATA SHOULD EXPLAIN THE RECOMMENDATION.</span></footer>
    </div>
  );
}

function SavedPlans({ plans, activePlanId, disabled, onOpen, onDelete, onNew }: {
  plans: SavedRecruitmentPlan[];
  activePlanId: string | null;
  disabled: boolean;
  onOpen: (plan: SavedRecruitmentPlan) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <section className="saved-plans" aria-label="保存的招募计划">
      <div className="saved-plans-heading">
        <div><span className="section-kicker">LOCAL WORKSPACE</span><h2>招募计划 <small>{plans.length}</small></h2></div>
        <button type="button" className="secondary-button new-plan-button" onClick={onNew} disabled={disabled}>＋ 新建案件</button>
      </div>
      {disabled && <p className="saved-plans-busy-note" role="status">当前调查尚未结束；完成或恢复结果后即可切换计划。</p>}
      {plans.length ? <div className="saved-plan-list">{plans.map((plan) => (
        <article className={`saved-plan-card ${activePlanId === plan.id ? "active" : ""}`} key={plan.id}>
          <div className="saved-plan-copy"><strong>{plan.name}</strong><span>{plan.lastReportedAt ? `最近报告 ${formatDate(plan.lastReportedAt)}` : "对话已保存，尚无报告"}</span></div>
          <div className="saved-plan-actions"><button type="button" className="text-button" aria-label={`打开招募计划：${plan.name}`} onClick={() => onOpen(plan)} disabled={disabled}>打开</button><button type="button" className="text-button danger-text" aria-label={`删除招募计划：${plan.name}`} onClick={() => onDelete(plan.id)} disabled={disabled}>删除</button></div>
        </article>
      ))}</div> : <p className="no-saved-plans">保存后，计划和最近一份分析报告会留在此浏览器。</p>}
    </section>
  );
}

export default App;
