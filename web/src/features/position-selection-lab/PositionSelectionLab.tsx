import { useState } from "react";
import { PositionPitchSelector } from "../recruitment/components/PositionPitchSelector";
import { Button } from "@/shared/ui/button";
import { positionSelectionLabel, selectablePositionsFor } from "../../../../src/domain/position-selection";
import { type SelectablePosition } from "../../../../src/domain/position-contracts.js";

/** Development-only paired interaction exercise; no provider or model calls. */
export function PositionSelectionLab() {
  const [presentation, setPresentation] = useState<"pitch" | "list">("pitch");
  const [width, setWidth] = useState("390");
  const [round, setRound] = useState(0);
  const [questionId, setQuestionId] = useState(() => crypto.randomUUID());
  const [confirmed, setConfirmed] = useState<SelectablePosition[] | null>(null);
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const [records, setRecords] = useState<Array<{ presentation: string; width: string; positions: string[]; correct: boolean; elapsedMs: number }>>([]);
  function restart(nextPresentation = presentation) { setPresentation(nextPresentation); setRound((value) => value + 1); setQuestionId(crypto.randomUUID()); setConfirmed(null); setStartedAt(performance.now()); }
  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
    <header className="space-y-2"><a href="/" className="text-sm underline underline-offset-4">返回球探对话</a><h1 className="m-0 text-2xl font-semibold">位置选择交互对照</h1><p className="text-sm leading-relaxed text-muted-foreground">练习任务：为球队寻找左后卫或左翼卫。两种展示使用相同的位置与确认逻辑；这里不会调用模型或查询真实球员。</p></header>
    <div className="flex flex-wrap gap-2" aria-label="对照展示方式"><Button variant={presentation === "pitch" ? "default" : "outline"} onClick={() => restart("pitch")}>足球场</Button><Button variant={presentation === "list" ? "default" : "outline"} onClick={() => restart("list")}>文字列表</Button><label className="flex items-center gap-2 text-sm">容器宽度<select className="min-h-10 rounded-md border bg-card px-2 text-base" value={width} onChange={(event) => setWidth(event.target.value)}><option value="320">320px</option><option value="390">390px</option><option value="480">480px</option></select></label></div>
    <div className="mx-auto max-w-full rounded-2xl bg-card p-3 shadow-sm sm:p-5" style={{ width: `${width}px` }}>
      {confirmed ? <div className="space-y-4"><p role="status">已选择：{positionSelectionLabel(confirmed)}</p><Button onClick={() => restart()}>重新选择</Button></div> : <PositionPitchSelector key={`${presentation}-${round}`} presentation={presentation} question={{ kind: "positions", questionId, highlightedPositions: selectablePositionsFor("DEF"), selectedPositions: [] }} onConfirm={(positions) => {
        setConfirmed(positions);
        setRecords((previous) => [...previous, { presentation, width, positions, correct: positions.length === 2 && positions.includes("LB") && positions.includes("LWB"), elapsedMs: Math.round(performance.now() - startedAt) }]);
      }} />}
    </div>
    <section className="space-y-3"><h2 className="m-0 text-base font-semibold">本次试用记录</h2><p className="text-xs text-muted-foreground">计时从题目展示开始。记录只用于观察，不代表已有真人效率结论。</p>{records.map((record, index) => <p key={index} className="text-sm">{record.presentation === "pitch" ? "球场" : "列表"} · {record.correct ? "选择正确" : "选择与题目不同"} · {(record.elapsedMs / 1000).toFixed(1)} 秒</p>)}<Button variant="outline" disabled={!records.length} onClick={() => {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ task: "LB or LWB", records }, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "position-interaction-comparison.json"; link.click(); URL.revokeObjectURL(url);
    }}>导出本次记录</Button></section>
  </main>;
}
