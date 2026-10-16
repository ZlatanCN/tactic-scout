import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp, Check, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { positionSelectionGroups, positionSelectionLabel, selectablePositionLabels } from "../../src/domain/position-selection";
import type { PositionSelectionQuestion, SelectablePosition } from "../../src/domain/schemas";

// Physical coordinates stay in the view; football position semantics live in the domain module.
const pitchSlots: { position: SelectablePosition; x: number; y: number }[] = [
  { position: "ST", x: 50, y: 13 },
  { position: "LW", x: 18, y: 25 }, { position: "RW", x: 82, y: 25 },
  { position: "AM", x: 50, y: 34 },
  { position: "CM", x: 50, y: 48 },
  { position: "LWB", x: 18, y: 59 }, { position: "RWB", x: 82, y: 59 },
  { position: "DM", x: 50, y: 64 },
  { position: "LB", x: 18, y: 78 }, { position: "CB", x: 50, y: 78 }, { position: "RB", x: 82, y: 78 },
  { position: "GK", x: 50, y: 91 },
];

function PitchMarkings() {
  const patternId = useId();
  return <svg viewBox="0 0 680 1050" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
    <defs><pattern id={patternId} width="680" height="175" patternUnits="userSpaceOnUse"><rect width="680" height="87.5" fill="white" opacity=".035" /></pattern></defs>
    <rect width="680" height="1050" fill={`url(#${patternId})`} />
    <g fill="none" stroke="currentColor" strokeWidth="2.5" className="text-pitch-line">
      <rect x="25" y="25" width="630" height="1000" rx="1" />
      <path d="M25 525H655" /><circle cx="340" cy="525" r="87" />
      <path d="M150 25V183H530V25 M255 25V77H425V25 M150 1025V867H530V1025 M255 1025V973H425V1025" />
      <path d="M270 183A87 87 0 0 0 410 183 M270 867A87 87 0 0 1 410 867" />
      <path d="M305 25V9H375V25 M305 1025V1041H375V1025" />
      <path d="M25 40A15 15 0 0 0 40 25 M640 25A15 15 0 0 0 655 40 M25 1010A15 15 0 0 1 40 1025 M640 1025A15 15 0 0 1 655 1010" />
    </g>
    <g fill="currentColor" className="text-pitch-line"><circle cx="340" cy="525" r="4" /><circle cx="340" cy="130" r="4" /><circle cx="340" cy="920" r="4" /></g>
  </svg>;
}

export function PositionPitchSelector({ question, disabled = false, onConfirm, onKeepCurrent, confirmLabel, presentation = "pitch" }: {
  question: PositionSelectionQuestion;
  disabled?: boolean;
  confirmLabel?: string;
  onConfirm: (positions: SelectablePosition[]) => void;
  onKeepCurrent?: () => void;
  /** Same choices and confirmation seam for the interaction comparison. */
  presentation?: "pitch" | "list";
}) {
  const descriptionId = useId();
  const selectorRef = useRef<HTMLElement>(null);
  useEffect(() => { selectorRef.current?.focus({ preventScroll: true }); }, [question.questionId]);
  const storageKey = `tactiscout.position-draft:${question.questionId}`;
  const [selected, setSelected] = useState<SelectablePosition[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved) && saved.every((position) => typeof position === "string" && position in selectablePositionLabels)) return [...new Set(saved)] as SelectablePosition[];
    } catch { /* A blocked or full browser store must not prevent selection. */ }
    return question.selectedPositions;
  });
  const [error, setError] = useState("");
  function update(positions: SelectablePosition[]) {
    setSelected(positions);
    setError("");
    try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch { /* In-memory selection remains usable. */ }
  }
  function toggle(position: SelectablePosition) {
    update(selected.includes(position) ? selected.filter((item) => item !== position) : [...selected, position]);
  }
  const positionButton = ({ position, x, y }: typeof pitchSlots[number]) => {
    const checked = selected.includes(position);
    const highlighted = question.highlightedPositions.includes(position);
    return <button key={position} type="button" aria-pressed={checked} disabled={disabled}
      aria-label={`${selectablePositionLabels[position]} ${position}`}
      onClick={() => toggle(position)}
      style={presentation === "pitch" ? { left: `${x}%`, top: `${y}%` } : undefined}
      className={cn("group touch-manipulation select-none rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-pitch-selected disabled:cursor-wait",
        presentation === "pitch" ? "absolute flex min-h-11 w-[4.75rem] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 @min-[320px]/pitch:min-h-14 @min-[320px]/pitch:gap-1" : "flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm focus-visible:outline-ring",
        presentation === "list" && checked && "border-primary bg-secondary")}>
      <span className={cn("relative grid size-6 shrink-0 @min-[320px]/pitch:size-8 place-items-center rounded-full border-2 text-[11px] font-semibold shadow-sm transition-colors duration-100",
        checked ? "border-pitch-selected bg-pitch-selected text-pitch-selected-foreground" : "border-pitch-marker bg-pitch-marker text-pitch-marker-foreground",
        !checked && !highlighted && presentation === "pitch" && "border-pitch-line bg-pitch-subtle text-pitch-label-foreground")}>{checked ? <Check className="size-4" aria-hidden="true" /> : position}</span>
      <span className={cn("whitespace-nowrap rounded px-1.5 py-0 text-xs @min-[320px]/pitch:py-0.5 font-medium leading-normal", presentation === "pitch" && (checked ? "bg-pitch-selected text-pitch-selected-foreground" : "bg-pitch-label text-pitch-label-foreground"))}>{selectablePositionLabels[position]}</span>
    </button>;
  };
  return <section ref={selectorRef} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring @container/pitch mx-auto w-full max-w-[30rem] space-y-4" aria-label="选择招募位置" aria-describedby={descriptionId}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p id={descriptionId} className="m-0 text-sm text-muted-foreground">{presentation === "pitch" ? "点击场上位置，可多选" : "选择位置，可多选"}</p>
      <Button variant="ghost" size="sm" disabled={disabled || !selected.length} onClick={() => update([])} className="min-h-11 gap-1.5 text-xs"><RotateCcw className="size-3.5" aria-hidden="true" />清空</Button>
    </div>
    <div className="flex flex-wrap gap-2" aria-label="按区域快捷选择">{positionSelectionGroups.map((group) => <Button key={group.label} variant="outline" size="sm" disabled={disabled} className="min-h-11" onClick={() => {
      const allSelected = group.positions.every((position) => selected.includes(position));
      update(allSelected ? selected.filter((position) => !(group.positions as readonly SelectablePosition[]).includes(position)) : [...new Set([...selected, ...group.positions])]);
    }}>{group.label}</Button>)}</div>
    {presentation === "pitch" ? <div className="overflow-hidden rounded-xl bg-pitch p-1.5 shadow-inner">
      <div className="flex items-center justify-center gap-1 pb-1 pt-0.5 text-xs font-medium text-pitch-label-foreground"><ArrowUp className="size-3" aria-hidden="true" />进攻方向</div>
      <div className="relative aspect-[68/105] w-full" role="group" aria-label="足球场位置"><PitchMarkings />{pitchSlots.map(positionButton)}</div>
    </div> : <div className="grid grid-cols-2 gap-2" role="group" aria-label="场上位置列表">{pitchSlots.map(positionButton)}</div>}
    <div className="space-y-3 rounded-xl bg-muted/60 p-4">
      <div role="status" className="min-h-6 text-sm font-medium">{selected.length ? `已选：${positionSelectionLabel(selected)}` : "还未选择位置"}</div>
      <p className="m-0 text-xs leading-relaxed text-muted-foreground">寻找能踢其中任一位置的球员。</p>
      <Button className="min-h-11 w-full justify-between" disabled={disabled} onClick={() => {
        if (!selected.length) { setError("请先选择至少一个位置。"); selectorRef.current?.querySelector<HTMLButtonElement>("button[aria-pressed]")?.focus(); return; }
        onConfirm(selected);
      }}>{disabled ? "正在继续调查…" : selected.length ? confirmLabel ?? `按这 ${selected.length} 个位置查找` : "选择位置后继续"}<ChevronRight className="size-4" aria-hidden="true" /></Button>
      {question.allowKeepCurrent && onKeepCurrent && <Button variant="outline" className="min-h-11 w-full" disabled={disabled} onClick={onKeepCurrent}>保留原范围并结束</Button>}
      {error && <p role="alert" className="m-0 text-sm text-destructive">{error}</p>}
    </div>
  </section>;
}
