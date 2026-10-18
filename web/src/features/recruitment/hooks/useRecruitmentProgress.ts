import { useCallback, useEffect, useState } from "react";
import { getRecruitmentProgress } from "../lib/api";
import { ApiContractError } from "../lib/api-contract";
import type { PendingTurnRequest } from "../lib/turn-requests";
import { type RecruitmentCandidatePreview, type RecruitmentProgress } from "../../../../../src/domain/conversation.js";

type ProgressConnection = "idle" | "connecting" | "live" | "stale" | "incompatible";

/** Owns the live progress snapshot, SSE projection, and polling fallback for one recruitment turn. */
export function useRecruitmentProgress(request: PendingTurnRequest | null, running: boolean, streamActive = false) {
  const [progress, setProgress] = useState<RecruitmentProgress | null>(null);
  const [candidatesPreview, setCandidatesPreview] = useState<RecruitmentCandidatePreview[]>([]);
  const [progressConnection, setProgressConnection] = useState<ProgressConnection>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const elapsedTimer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(elapsedTimer);
  }, [startedAt]);

  useEffect(() => {
    const recoveringTurn = request?.outcomeUnknown === true;
    if (!request || (!running && !recoveringTurn) || startedAt === null || streamActive) return;

    let disposed = false;
    let consecutiveFailures = 0;
    let pollTimer: number | undefined;

    const poll = async () => {
      try {
        const current = await getRecruitmentProgress(request.caseId, request.requestId);
        if (!disposed && current.requestId === request.requestId) {
          consecutiveFailures = 0;
          setProgress(current);
          setProgressConnection("live");
        }
      } catch (error) {
        consecutiveFailures += 1;
        if (!disposed) {
          if (error instanceof ApiContractError) {
            setProgressConnection("incompatible");
          } else {
            setProgressConnection((previous) => previous === "incompatible"
              ? "incompatible"
              : previous === "live" || previous === "stale" || consecutiveFailures >= 5
                ? "stale"
                : "connecting");
          }
        }
      }
      if (!disposed) pollTimer = window.setTimeout(() => void poll(), 1200);
    };

    void poll();
    return () => {
      disposed = true;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [request?.caseId, request?.outcomeUnknown, request?.requestId, running, startedAt, streamActive]);

  const begin = useCallback((requestId: string) => {
    const timestamp = Date.now();
    setStartedAt(timestamp);
    setElapsedSeconds(0);
    setProgressConnection("connecting");
    setProgress({
      requestId,
      active: true,
      stage: "starting",
      message: "正在启动本轮球探调查",
      completedSteps: 0,
      updatedAt: new Date(timestamp).toISOString(),
      events: [],
    });
  }, []);

  const markCancelling = useCallback((requestId: string) => {
    const occurredAt = new Date().toISOString();
    setProgress((current) => current?.requestId === requestId ? {
      ...current,
      active: true,
      stage: "cancelling",
      message: "已收到停止请求，正在结束本轮调查",
      updatedAt: occurredAt,
      events: current.events.some((event) => event.stage === "cancelling") ? current.events : [...current.events, {
        sequence: (current.events.at(-1)?.sequence ?? 0) + 1,
        occurrence: 1,
        stage: "cancelling" as const,
        status: "started" as const,
        message: "已收到停止请求，正在结束本轮调查",
        occurredAt,
      }].slice(-24),
    } : current);
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
    setProgressConnection("idle");
    setStartedAt(null);
    setElapsedSeconds(0);
  }, []);

  const stopClock = useCallback(() => setStartedAt(null), []);
  const updateFromStream = useCallback((requestId: string, current: RecruitmentProgress) => {
    if (current.requestId !== requestId) return;
    setProgress(current);
    if (!current.active) setCandidatesPreview([]);
    setProgressConnection("live");
  }, []);
  const updateCandidatesFromStream = useCallback((requestId: string, candidates: RecruitmentCandidatePreview[]) => {
    if (requestId !== request?.requestId) return;
    setCandidatesPreview(candidates);
  }, [request?.requestId]);
  const markStreamUnavailable = useCallback(() => {
    setProgressConnection((current) => current === "incompatible" ? current : "stale");
  }, []);

  return { progress, candidatesPreview, progressConnection, elapsedSeconds, begin, markCancelling, reset, stopClock, updateFromStream, updateCandidatesFromStream, markStreamUnavailable };
}
