import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import {
  clearRecruitmentPreferences,
  deleteRecruitmentPreference,
  getRecruitmentPreferences,
  saveRecruitmentPreference,
} from "../lib/api";
import type { RecruitmentPreference } from "../../../../../src/recruitment/preferences/schemas.js";

interface Props { onClose: () => void }

const focusOptions = [
  ["defensive_actions", "防守行动"],
  ["progression", "推进"],
  ["chance_creation", "创造机会"],
  ["duels", "对抗"],
] as const;
const competitionOptions = ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1"] as const;
type FocusValue = typeof focusOptions[number][0] | "";
type CompetitionValue = typeof competitionOptions[number] | "";

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RecruitmentPreferencesDialog({ onClose }: Props) {
  const [items, setItems] = useState<RecruitmentPreference[]>([]);
  const [focus, setFocus] = useState<FocusValue>("");
  const [competition, setCompetition] = useState<CompetitionValue>("");
  const [approved, setApproved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await getRecruitmentPreferences();
      setItems(next);
      setFocus((next.find((item) => item.key === "analysis_focus")?.value as FocusValue | undefined) ?? "");
      setCompetition((next.find((item) => item.key === "preferred_competition")?.value as CompetitionValue | undefined) ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取已保存偏好。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function saveSelected() {
    if (!approved || (!focus && !competition)) return;
    setSaving(true);
    setError(null);
    try {
      if (focus) await saveRecruitmentPreference({ key: "analysis_focus", value: focus, explicitlyApproved: true });
      if (competition) await saveRecruitmentPreference({ key: "preferred_competition", value: competition, explicitlyApproved: true });
      setApproved(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存偏好。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(key: RecruitmentPreference["key"]) {
    setSaving(true);
    setError(null);
    try {
      await deleteRecruitmentPreference(key);
      await refresh();
      setApproved(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法删除偏好。");
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!window.confirm("清空此浏览器身份保存的全部长期偏好？")) return;
    setSaving(true);
    setError(null);
    try {
      await clearRecruitmentPreferences();
      setItems([]);
      setFocus("");
      setCompetition("");
      setApproved(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法清空偏好。");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[min(90vh,48rem)] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>长期偏好</DialogTitle>
        <DialogDescription>只保存你在这里明确确认的分析重点或常看联赛。每项最多保存一个；不会保存候选、报告或案件事实。</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        {loading ? <p role="status" className="m-0 text-sm text-muted-foreground">正在读取此浏览器的偏好…</p> : <>
          <label className="grid gap-1.5 text-sm font-medium">默认分析重点
            <select className={selectClass} value={focus} onChange={(event) => { setFocus(event.target.value as FocusValue); setApproved(false); }}>
              <option value="">不设置</option>
              {focusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">默认关注联赛
            <select className={selectClass} value={competition} onChange={(event) => { setCompetition(event.target.value as CompetitionValue); setApproved(false); }}>
              <option value="">不设置</option>
              {competitionOptions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <input type="checkbox" className="mt-1 size-4 accent-primary" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
            <span>我明确同意将当前选择保存在此浏览器身份，并用于之后未指定这些条件的新案件。</span>
          </label>
          <Button type="button" onClick={() => void saveSelected()} disabled={saving || !approved || (!focus && !competition)}>{saving ? "保存中…" : "保存已选偏好"}</Button>
          {items.length > 0 && <div className="grid gap-2 rounded-lg border p-3">
            <h3 className="m-0 text-sm font-semibold">已保存</h3>
            {items.map((item) => <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{item.key === "analysis_focus" ? `分析重点：${focusOptions.find(([value]) => value === item.value)?.[1] ?? item.value}` : `关注联赛：${item.value}`}</span>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => void remove(item.key)}><Trash2 aria-hidden="true" />删除</Button>
            </div>)}
            <Button type="button" variant="outline" className="text-destructive" disabled={saving} onClick={() => void clearAll()}>清空此浏览器的全部偏好</Button>
          </div>}
        </>}
        <p className="m-0 rounded-md bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">每次新请求的明确条件始终优先；偏好只作为未指定字段的建议默认值，不会写入案件记录。</p>
        {error && <p role="alert" className="m-0 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}<button type="button" className="ml-2 underline" onClick={() => void refresh()}>重试</button></p>}
      </div>
    </DialogContent>
  </Dialog>;
}
