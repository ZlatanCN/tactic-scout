import { useCallback, useEffect, useState } from "react";
import { ApiContractError, getRecruitmentProgress } from "./api";
import type { PendingTurnRequest } from "./turn-requests";
import type { RecruitmentProgress } from "../../src/domain/schemas.js";

type ProgressConnection = "idle" | "connecting" | "live" | "stale" | "incompatible";

/** Owns the live progress snapshot and polling lifecycle for one recruitment turn. */
export function useRecruitmentProgress(request: PendingTurnRequest | null, running: boolean) {
  const [progress, setProgress] = useState<RecruitmentProgress | null>(null);
  const [progressConnection, setProgressConnection] = useState<ProgressConnection>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const recoveringTurn = request?.outcomeUnknown === true;
    if (!request || (!running && !recoveringTurn) || startedAt === null) return;

    const updateElapsed = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    updateElapsed();
    const elapsedTimer = window.setInterval(updateElapsed, 1000);
    let disposed = false;
    let consecutiveFailures = 0;
    let pollTimer: number | undefined;

    const poll = async () => {
      try {
        const current = await getRecruitmentProgress(request.caseId, request.requestId);
        if (!disposed) {
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
      window.clearInterval(elapsedTimer);
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    };
  }, [request?.caseId, request?.outcomeUnknown, request?.requestId, running, startedAt]);

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

  return { progress, progressConnection, elapsedSeconds, begin, markCancelling, reset, stopClock };
}
