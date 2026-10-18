import { loadActiveRecruitmentSession, saveActiveRecruitmentSession } from "../lib/active-session";
import { positionSelectionLabel } from "../../../../../src/domain/position-selection";
import { type PlayerIdentityAnswer, type PositionSelectionAnswer, type SelectablePosition } from "../../../../../src/domain/position-contracts.js";
import { useEffect, useState } from "react";
import { cancelRecruitmentTurn, turnRecruitmentCase, turnRecruitmentCaseStream } from "../lib/api";
import { ApiStreamError } from "../lib/api-contract";
import { shouldFallbackRecruitmentStreamToJson } from "../lib/recruitment-sse";
import { formatDate } from "../lib/format-date";
import { isTurnUnresolved, resolveTurnRequest, type PendingTurnRequest } from "../lib/turn-requests";
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
} from "../lib/plans";
import { useRecruitmentProgress } from "./useRecruitmentProgress";
import { type TeamRosterContext } from "../../../../../src/domain/conversation.js";
import { type RecruitmentReport } from "../../../../../src/domain/reports.js";

function describeTurnError(error: unknown): string {
  if (!(error instanceof Error)) return "对话暂时无法继续，请稍后再试。你输入的内容还在。";
  if (/生成长度上限|OPENAI_(?:EXPANSION_)?MAX_OUTPUT_TOKENS/.test(error.message)) {
    return "模型回复不完整，本轮调查尚未完成。你的需求已保留，请重新发送；若重复出现，请检查模型服务后再试。";
  }
  if (/模型请求超过.*秒仍未响应/.test(error.message)) {
    return "模型响应超时，本轮调查没有完成。你的需求已保留，可以重新发送。";
  }
  if (/模型未返回符合要求的规划结果/.test(error.message)) {
    return "模型暂时无法完成调查。你的需求已保留，请检查模型服务后重试。";
  }
  if (/connection error|econnrefused|fetch failed/i.test(error.message)) {
    return "无法连接当前配置的模型服务。若使用 Ollama，请确认它正在运行，并检查模型服务配置后重试；你的需求已保留。";
  }
  return error.message;
}

/** Owns one recruitment conversation, its turn lifecycle, and its saved snapshot. */
export function useRecruitmentSession() {
  const [restoredSession] = useState(loadActiveRecruitmentSession);
  const [threadId, setThreadId] = useState<string>(() => restoredSession?.threadId ?? crypto.randomUUID());
  const [messages, setMessages] = useState<ConversationMessage[]>(restoredSession?.messages ?? []);
  const [report, setReport] = useState<RecruitmentReport | null>(restoredSession?.report ?? null);
  const [teamRosterContext, setTeamRosterContext] = useState<TeamRosterContext | null>(null);
  const [reportAt, setReportAt] = useState<string | null>(restoredSession?.reportAt ?? null);
  const [status, setStatus] = useState<"ready" | "needs_input" | "completed">(restoredSession?.status ?? "ready");
  const [draft, setDraft] = useState("");
  const [workspaceView, setWorkspaceView] = useState<"conversation" | "report">("conversation");
  const [teamContext, setTeamContext] = useState("");
  const [planName, setPlanName] = useState(restoredSession?.planName ?? "");
  const [originalBrief, setOriginalBrief] = useState(restoredSession?.originalBrief ?? "");
  const [plans, setPlans] = useState<SavedRecruitmentPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(restoredSession?.activePlanId ?? null);
  const [hasConversationState, setHasConversationState] = useState(restoredSession?.hasConversationState ?? false);
  const [loading, setLoading] = useState(false);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [pendingTurnRequest, setPendingTurnRequest] = useState<PendingTurnRequest | null>(restoredSession?.pendingTurnRequest ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    try { saveActiveRecruitmentSession({ threadId, messages, report, reportAt, status, originalBrief, planName, activePlanId, hasConversationState, pendingTurnRequest }); }
    catch { setNotice("浏览器暂时无法保存当前调查，刷新前请保留重要结果。"); }
  }, [threadId, messages, report, reportAt, status, originalBrief, planName, activePlanId, hasConversationState, pendingTurnRequest]);
  const [streamActive, setStreamActive] = useState(false);
  const progressRuntime = useRecruitmentProgress(pendingTurnRequest, loading, streamActive);
  const { progress, progressConnection, elapsedSeconds, candidatesPreview } = progressRuntime;

  useEffect(() => {
    try {
      setPlans(loadRecruitmentPlans());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "本地计划无法读取。");
    }
  }, []);

  const waitingForAnswer = status === "needs_input";
  const turnUnresolved = isTurnUnresolved(loading, pendingTurnRequest);
  const userCount = messages.filter((message) => message.role === "user").length;
  const isFreshCase = messages.length === 0 && !pendingTurnRequest && !report;

  function persistPlans(nextPlans: SavedRecruitmentPlan[], successMessage?: string): boolean {
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
      progressRuntime.markCancelling(request.requestId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "停止请求没有送达；本轮调查仍可能在运行。可稍后重试。");
    } finally {
      setCancellingRequestId(null);
    }
  }

  async function sendMessage(messageText = draft, mode: "normal" | "reanalysis" = "normal", positionAnswer?: PositionSelectionAnswer, positionUpdate?: SelectablePosition[], playerIdentityAnswer?: PlayerIdentityAnswer) {
    const text = messageText.trim();
    if (!text || loading) return;
    positionAnswer ??= pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.displayText === text ? pendingTurnRequest.positionAnswer : undefined;
    const isReanalysis = mode === "reanalysis";
    const canRecoverReanalysis = isReanalysis && pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.isReanalysis;
    if (isReanalysis && (!activePlanId || !report || (status !== "completed" && !canRecoverReanalysis))) return;
    positionUpdate ??= pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.displayText === text ? pendingTurnRequest.positionUpdate : undefined;
    playerIdentityAnswer ??= pendingTurnRequest?.outcomeUnknown && pendingTurnRequest.displayText === text ? pendingTurnRequest.playerIdentityAnswer : undefined;
    if (isReanalysis) positionUpdate ??= messages.slice().reverse().find((message) => message.selectedPositions?.length)?.selectedPositions;
    const displayText = isReanalysis
      ? "重新分析当前招募需求，并按最新可用数据重新搜索候选人。"
      : positionUpdate ? `已选择：${positionSelectionLabel(positionUpdate)}` : text;
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: displayText,
      ...((positionAnswer?.positions ?? positionUpdate) ? { selectedPositions: positionAnswer?.positions ?? positionUpdate } : {}),
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
        ...(positionAnswer ? { positionAnswer } : {}),
        ...(playerIdentityAnswer ? { playerIdentityAnswer } : {}),
        ...(positionUpdate ? { positionUpdate } : {}),
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
    if (isReanalysis) setStatus("ready");
    setPendingTurnRequest({ ...request, outcomeUnknown: false });
    if (!isReanalysis) setDraft("");

    setLoading(true);
    setStreamActive(true);
    progressRuntime.begin(request.requestId);
    setError(null);
    setNotice(null);

    try {
      let response;
      let streamStarted = false;
      try {
        response = await turnRecruitmentCaseStream(
          request.caseId,
          request.message,
          request.expectsExistingState,
          request.requestId,
          request.positionAnswer,
          request.positionUpdate,
          request.playerIdentityAnswer,
          {
            onProgress: (progress) => {
              streamStarted = true;
              progressRuntime.updateFromStream(request.requestId, progress);
            },
            onCandidates: (candidates) => {
              progressRuntime.updateCandidatesFromStream(request.requestId, candidates);
            },
            onHeaders: () => { streamStarted = true; },
          },
        );
      } catch (streamError) {
        if (!shouldFallbackRecruitmentStreamToJson(streamError, { started: streamStarted })) throw streamError;
        progressRuntime.markStreamUnavailable();
        setStreamActive(false);
        response = await turnRecruitmentCase(request.caseId, request.message, request.expectsExistingState, request.requestId, request.positionAnswer, request.positionUpdate, request.playerIdentityAnswer);
      }
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
        progressRuntime.stopClock();
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
        : "本轮调查已完成，但暂时无法显示具体步骤。重启服务后，新一轮调查会显示进度。";
      const assistantMessage = messageFromTurn(response, progressNotice);
      const updatedMessages = [...nextMessages, userMessage, assistantMessage];
      const now = new Date().toISOString();
      const completedReport = response.status === "completed" ? response.report : null;
      const updatedReport = completedReport ?? report;
      const updatedReportAt = completedReport ? now : reportAt;

      setMessages(updatedMessages);
      setReport(updatedReport);
      setWorkspaceView(response.status === "needs_input" || !completedReport ? "conversation" : "report");
      if (completedReport) setTeamRosterContext(response.teamRosterContext ?? null);
      setReportAt(updatedReportAt);
      setThreadId(request.caseId);
      setStatus(response.status);
      setDraft(response.retryMessage ? text : "");
      setTeamContext(response.retryMessage ? teamContext : "");
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
        setError(caught instanceof ApiStreamError && caught.kind === "interrupted"
          ? "实时进度连接提前结束，本轮结果尚未确认。恢复连接后点击“恢复本轮结果”；服务端仍运行时不会重复执行。"
          : "连接中断，本轮结果尚未确认。恢复连接后点击“恢复本轮结果”；服务进程仍运行时，已接收的请求不会重复执行。");
      } else {
        setPendingTurnRequest(null);
        progressRuntime.stopClock();
        if (isReanalysis) setStatus("completed");
        setError(describeTurnError(caught));
      }
    } finally {
      setStreamActive(false);
      setLoading(false);
      setCancellingRequestId(null);
    }
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
    setWorkspaceView(plan.lastReport ? "report" : "conversation");
    setError(null);
    progressRuntime.reset();
    setNotice(plan.lastReportedAt
      ? `已打开计划，显示 ${formatDate(plan.lastReportedAt)} 保存的最近报告。`
      : "已打开保存的招募对话。补充信息后，球探会接着调查。");
  }

  function startNewCase() {
    if (turnUnresolved) return;
    setThreadId(crypto.randomUUID());
    setMessages([]);
    setWorkspaceView("conversation");
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
    progressRuntime.reset();
  }

  function deletePlan(id: string) {
    if (turnUnresolved) return;
    const plan = plans.find((item) => item.id === id);
    if (!plan || !window.confirm(`确定删除“${plan.name}”吗？`)) return;
    const next = removeRecruitmentPlan(plans, id);
    if (persistPlans(next, "已删除本地计划。") && activePlanId === id) startNewCase();
  }

  return {
    state: {
      threadId,
      messages,
      report,
      teamRosterContext,
      reportAt,
      status,
      draft,
      workspaceView,
      teamContext,
      planName,
      originalBrief,
      plans,
      activePlanId,
      hasConversationState,
      loading,
      cancellingRequestId,
      pendingTurnRequest,
      progress,
      candidatesPreview,
      progressConnection,
      elapsedSeconds,
      error,
      notice,
      waitingForAnswer,
      turnUnresolved,
      userCount,
      isFreshCase,
    },
    actions: {
      sendMessage,
      cancelCurrentTurn,
      setDraft,
      setTeamContext,
      setPlanName,
      saveCurrentPlan,
      openPlan,
      startNewCase,
      deletePlan,
      setWorkspaceView,
    },
  };
}
