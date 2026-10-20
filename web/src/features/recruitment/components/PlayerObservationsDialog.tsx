import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, Plus, Save, Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Separator } from "@/shared/ui/separator";
import { Textarea } from "@/shared/ui/textarea";
import {
  deletePlayerObservation,
  getPlayerObservations,
  savePlayerObservation,
} from "../lib/api";
import {
  PlayerObservationDimensionDefinitions,
  PlayerObservationInputSchema,
  PlayerObservationRatingSchema,
  PlayerObservationDimensionSchema,
  PlayerObservationViewingScopeDefinitions,
  PlayerObservationViewingScopeSchema,
  type PlayerObservation,
  type PlayerObservationInput,
} from "../../../../../src/observations/schemas.js";
import { PositionSchema } from "../../../../../src/domain/position-contracts.js";
import { summarizePlayerObservationDataset } from "../../../../../src/observations/dataset-summary.js";

interface Props {
  onClose: () => void;
}

interface Draft {
  playerName: string;
  playerAliases: string;
  playerIdentityProvider: string;
  externalPlayerId: string;
  teamAtObservation: string;
  observedPosition: string;
  observedRole: string;
  competition: string;
  season: string;
  match: string;
  viewingScope: string;
  viewedMinuteRanges: string;
  observedAt: string;
  matchMinute: string;
  observer: string;
  strengths: string;
  risks: string;
  ratings: Array<{ dimension: string; rating: string; matchMinute: string; evidence: string }>;
  evidenceNote: string;
  sourceReferenceUrl: string;
  allowPersistentStorage: boolean;
  allowAiProcessing: boolean;
}

function ObservationField({ label, required = false, wide = false, children }: { label: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return <label className={`grid min-w-0 content-start gap-1.5 text-xs font-medium text-foreground ${wide ? "sm:col-span-2" : ""}`}>
    <span>{label}{required && <span className="ml-1 text-destructive" aria-hidden="true">*</span>}</span>
    {children}
  </label>;
}

const selectClassName = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring";

function today(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function emptyDraft(): Draft {
  return {
    playerName: "",
    playerAliases: "",
    playerIdentityProvider: "",
    externalPlayerId: "",
    teamAtObservation: "",
    observedPosition: "",
    observedRole: "",
    competition: "",
    season: "",
    match: "",
    viewingScope: "",
    viewedMinuteRanges: "",
    observedAt: today(),
    matchMinute: "",
    observer: "",
    strengths: "",
    risks: "",
    ratings: [],
    evidenceNote: "",
    sourceReferenceUrl: "",
    allowPersistentStorage: false,
    allowAiProcessing: false,
  };
}

function draftFromRecord(record: PlayerObservation): Draft {
  return {
    playerName: record.playerName,
    playerAliases: record.playerAliases.join("\n"),
    playerIdentityProvider: record.playerIdentityProvider ?? "",
    externalPlayerId: record.externalPlayerId ?? "",
    teamAtObservation: record.teamAtObservation ?? "",
    observedPosition: record.observedPosition ?? "",
    observedRole: record.observedRole ?? "",
    competition: record.competition ?? "",
    season: record.season ?? "",
    match: record.match ?? "",
    viewingScope: record.viewingScope ?? "",
    viewedMinuteRanges: record.viewedMinuteRanges ?? "",
    observedAt: record.observedAt,
    matchMinute: record.matchMinute === null ? "" : String(record.matchMinute),
    observer: record.observer,
    strengths: record.strengths.join("\n"),
    risks: record.risks.join("\n"),
    ratings: record.ratings.map((rating) => ({
      dimension: rating.dimension,
      rating: String(rating.rating),
      matchMinute: rating.matchMinute === null ? "" : String(rating.matchMinute),
      evidence: rating.evidence,
    })),
    evidenceNote: record.evidenceNote,
    sourceReferenceUrl: record.sourceReferenceUrl ?? "",
    allowPersistentStorage: record.allowPersistentStorage,
    allowAiProcessing: record.allowAiProcessing,
  };
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function inputFromDraft(draft: Draft): PlayerObservationInput {
  return PlayerObservationInputSchema.parse({
    playerName: draft.playerName,
    playerAliases: lines(draft.playerAliases),
    playerIdentityProvider: draft.playerIdentityProvider.trim() || null,
    externalPlayerId: draft.externalPlayerId.trim() || null,
    teamAtObservation: draft.teamAtObservation.trim() || null,
    observedPosition: draft.observedPosition || null,
    observedRole: draft.observedRole.trim() || null,
    competition: draft.competition.trim() || null,
    season: draft.season.trim() || null,
    match: draft.match.trim() || null,
    viewingScope: draft.viewingScope ? PlayerObservationViewingScopeSchema.parse(draft.viewingScope) : null,
    viewedMinuteRanges: draft.viewedMinuteRanges.trim() || null,
    observedAt: draft.observedAt,
    matchMinute: draft.matchMinute.trim() ? Number(draft.matchMinute) : null,
    observer: draft.observer,
    strengths: lines(draft.strengths),
    risks: lines(draft.risks),
    ratings: draft.ratings.map((rating) => PlayerObservationRatingSchema.parse({
      dimension: PlayerObservationDimensionSchema.parse(rating.dimension),
      rating: Number(rating.rating),
      matchMinute: rating.matchMinute.trim() ? Number(rating.matchMinute) : null,
      evidence: rating.evidence,
    })),
    evidenceNote: draft.evidenceNote,
    sourceReferenceUrl: draft.sourceReferenceUrl.trim() || null,
    allowPersistentStorage: draft.allowPersistentStorage,
    allowAiProcessing: draft.allowAiProcessing,
  });
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请检查观察记录后再保存。";
}

export function PlayerObservationsDialog({ onClose }: Props) {
  const [records, setRecords] = useState<PlayerObservation[]>([]);
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedRecord = records.find((record) => record.id === selectedId);
  const ratingContextRequired = draft.ratings.length > 0;
  const datasetSummary = useMemo(() => summarizePlayerObservationDataset(records), [records]);

  useEffect(() => {
    let active = true;
    getPlayerObservations()
      .then((loaded) => { if (active) setRecords(loaded); })
      .catch((caught: unknown) => { if (active) setError(validationMessage(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setDraft(selectedId === "new" ? emptyDraft() : selectedRecord ? draftFromRecord(selectedRecord) : emptyDraft());
    setError(null);
  }, [selectedId, selectedRecord]);

  function updateDraft<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateRating(index: number, field: keyof Draft["ratings"][number], value: string) {
    setDraft((current) => ({
      ...current,
      ratings: current.ratings.map((rating, currentIndex) => currentIndex === index ? { ...rating, [field]: value } : rating),
    }));
  }

  function addRating() {
    if (draft.ratings.length >= 8) return;
    const selected = new Set(draft.ratings.map((rating) => rating.dimension));
    const nextDimension = PlayerObservationDimensionSchema.options.find((dimension) => !selected.has(dimension))
      ?? PlayerObservationDimensionSchema.options[0];
    updateDraft("ratings", [...draft.ratings, { dimension: nextDimension, rating: "", matchMinute: "", evidence: "" }]);
  }

  function removeRating(index: number) {
    updateDraft("ratings", draft.ratings.filter((_rating, currentIndex) => currentIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setNotice(null);
    let input: PlayerObservationInput;
    try {
      input = inputFromDraft(draft);
    } catch (caught) {
      setError(validationMessage(caught));
      return;
    }

    setSaving(true);
    try {
      const saved = await savePlayerObservation(selectedId === "new" ? null : selectedId, input);
      setRecords((current) => [...current.filter((record) => record.id !== saved.id), saved]);
      setSelectedId(saved.id);
      setNotice(saved.indexStatus === "indexed"
        ? "观察已保存，并已加入 Agent 的球员报告检索。"
        : saved.indexStatus === "index_failed"
          ? "观察已保存在本机，但索引暂未完成；再次保存可重试。"
          : "观察已保存在本机；只有你明确授权后才会加入 Agent 检索。 ");
    } catch (caught) {
      setError(validationMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected(askForConfirmation = true) {
    if (!selectedRecord || saving) return;
    if (askForConfirmation && !window.confirm(`删除 ${selectedRecord.playerName} 的这条球探观察？`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await deletePlayerObservation(selectedRecord.id);
      setRecords((current) => current.filter((record) => record.id !== selectedRecord.id));
      setSelectedId("new");
      setNotice("已删除本机观察记录，并从当前检索索引中移除。");
    } catch (caught) {
      setError(validationMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  function changeStoragePermission(allowed: boolean) {
    if (allowed) {
      updateDraft("allowPersistentStorage", true);
      return;
    }
    if (selectedRecord) {
      if (!window.confirm(`撤回本地保存授权会删除 ${selectedRecord.playerName} 的这条观察和当前检索片段。继续吗？`)) return;
      void removeSelected(false);
      return;
    }
    updateDraft("allowPersistentStorage", false);
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={false} className="grid h-[min(94dvh,980px)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-[calc(100vw-2rem)] sm:max-w-6xl">
      <DialogHeader className="flex flex-row items-start justify-between gap-4 border-b px-4 py-4 text-left sm:px-6">
        <div className="min-w-0">
          <Badge variant="secondary" className="mb-2">本机观察资料</Badge>
          <DialogTitle id="observation-dialog-title" className="text-xl font-semibold tracking-tight">球探观察记录</DialogTitle>
          <DialogDescription id="observation-dialog-description" className="mt-2 max-w-3xl leading-5">每条记录对应一名球员的一场比赛。写明赛事、赛季、比赛和具体场景；这里不会抓取外部链接，也不应粘贴第三方报告全文。</DialogDescription>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭球探观察" onClick={onClose} disabled={saving}><X aria-hidden="true" /></Button>
      </DialogHeader>

      <div className="grid min-h-0 grid-cols-1 overflow-y-auto overscroll-contain sm:grid-cols-[250px_minmax(0,1fr)] sm:overflow-hidden">
        <aside className="space-y-3 border-b bg-muted/30 p-3 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-4" aria-label="已有观察记录">
          <Button type="button" variant={selectedId === "new" ? "default" : "outline"} className="w-full justify-start" onClick={() => { setNotice(null); setSelectedId("new"); }}><Plus aria-hidden="true" />新建观察</Button>
          <Card className="gap-3 py-3">
            <CardHeader className="px-3 py-0"><CardTitle className="text-sm">自采样本</CardTitle><p className="m-0 text-xs text-muted-foreground">按记录统计，不按姓名合并</p></CardHeader>
            <CardContent className="space-y-3 px-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted p-2"><dd className="m-0 text-lg font-semibold tabular-nums">{datasetSummary.observationRecords}</dd><dt className="text-muted-foreground">场次记录</dt></div>
                <div className="rounded-md bg-muted p-2"><dd className="m-0 text-lg font-semibold tabular-nums">{datasetSummary.matchScopedRecords}/{datasetSummary.observationRecords}</dd><dt className="text-muted-foreground">比赛信息齐全</dt></div>
                <div className="rounded-md bg-muted p-2"><dd className="m-0 text-lg font-semibold tabular-nums">{datasetSummary.ratingEntries}</dd><dt className="text-muted-foreground">能力判断</dt></div>
                <div className="rounded-md bg-muted p-2"><dd className="m-0 text-lg font-semibold tabular-nums">{datasetSummary.indexedRecords}</dd><dt className="text-muted-foreground">已授权检索</dt></div>
              </dl>
              {datasetSummary.ratingEntries > 0 && <div className="flex flex-wrap gap-1.5" aria-label="各能力维度记录数">
                {datasetSummary.dimensionCoverage.filter((item) => item.recordCount > 0).map((item) => <Badge variant="outline" key={item.dimension}>{item.label}<span className="ml-1 tabular-nums">{item.recordCount}</span></Badge>)}
              </div>}
              {datasetSummary.observationRecords === 0 && <p className="m-0 text-xs leading-5 text-muted-foreground">还没有真实样本。先固定一个位置和比赛范围，再按同一量表记录场景；没有看到的维度留空。</p>}
            </CardContent>
          </Card>
          {loading ? <p className="px-1 py-2 text-xs text-muted-foreground">正在读取本机记录…</p> : records.length === 0
            ? <p className="px-1 py-2 text-xs text-muted-foreground">还没有自录观察。</p>
            : <ul className="space-y-1" aria-label="观察记录列表">
              {records.map((record) => <li key={record.id}>
                <button type="button" className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${selectedId === record.id ? "border-primary/30 bg-secondary" : "border-transparent hover:border-border hover:bg-card"}`} onClick={() => { setNotice(null); setSelectedId(record.id); }}>
                  <strong className="block break-words text-sm">{record.playerName}</strong>
                  <span className="mt-1 block text-xs text-muted-foreground">{record.observedAt} · {record.competition ?? "赛事待补"}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{record.viewingScope ? PlayerObservationViewingScopeDefinitions[record.viewingScope] : "观看范围未记录"}{record.viewedMinuteRanges ? ` · ${record.viewedMinuteRanges}` : ""}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{record.ratings.length ? `${record.ratings.length} 项能力观察 · ` : ""}{record.indexStatus === "indexed" ? "已加入 Agent 检索" : record.indexStatus === "index_failed" ? "索引待重试" : "仅保存在本机"}</span>
                </button>
              </li>)}
            </ul>}
          <p className="m-0 text-[11px] leading-5 text-muted-foreground">本机服务保存于忽略提交的 <code className="break-all">.data/player-observations.json</code>。</p>
        </aside>

        <form className="min-w-0 space-y-5 p-4 sm:overflow-y-auto sm:p-6" onSubmit={(event) => void submit(event)}>
          {selectedRecord?.indexStatus === "index_failed" && <Alert className="border-warning/50 bg-warning/10 text-warning"><AlertCircle aria-hidden="true" /><AlertDescription>这条观察尚未进入检索索引。保留模型处理授权并重新保存可再次尝试。</AlertDescription></Alert>}
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <ObservationField label="球员姓名" required wide><Input autoFocus value={draft.playerName} onChange={(event) => updateDraft("playerName", event.target.value)} required maxLength={120} /></ObservationField>
            <ObservationField label="观察日期" required><Input type="date" value={draft.observedAt} onChange={(event) => updateDraft("observedAt", event.target.value)} required /></ObservationField>
            <ObservationField label="观察者" required><Input value={draft.observer} onChange={(event) => updateDraft("observer", event.target.value)} required maxLength={120} placeholder="你的姓名或观察者署名" /></ObservationField>
            <ObservationField label="其他球员姓名"><Textarea rows={2} value={draft.playerAliases} onChange={(event) => updateDraft("playerAliases", event.target.value)} placeholder="每行一个，例如常用拼写" /></ObservationField>
            <ObservationField label="关联数据来源"><Input value={draft.playerIdentityProvider} onChange={(event) => updateDraft("playerIdentityProvider", event.target.value)} placeholder="例如 Sportmonks" maxLength={80} /></ObservationField>
            <ObservationField label="来源中的球员 ID"><Input value={draft.externalPlayerId} onChange={(event) => updateDraft("externalPlayerId", event.target.value)} placeholder="与上项同时填写" maxLength={120} /></ObservationField>
            <ObservationField label="观察时效力球队"><Input value={draft.teamAtObservation} onChange={(event) => updateDraft("teamAtObservation", event.target.value)} placeholder="由观察者记录" maxLength={120} /></ObservationField>
            <ObservationField label="观察时位置"><select className={selectClassName} value={draft.observedPosition} onChange={(event) => updateDraft("observedPosition", event.target.value)}><option value="">未知 / 未记录</option>{PositionSchema.options.map((position) => <option key={position} value={position}>{position}</option>)}</select></ObservationField>
            <ObservationField label="观察时职责" wide><Input value={draft.observedRole} onChange={(event) => updateDraft("observedRole", event.target.value)} placeholder="例如右侧中卫、内收边后卫；只记这场比赛中的职责" maxLength={120} /></ObservationField>
            <ObservationField label="赛事" required={ratingContextRequired}><Input value={draft.competition} onChange={(event) => updateDraft("competition", event.target.value)} placeholder="例如 Bundesliga" maxLength={120} required={ratingContextRequired} /></ObservationField>
            <ObservationField label="赛季" required={ratingContextRequired}><Input value={draft.season} onChange={(event) => updateDraft("season", event.target.value)} placeholder="例如 2025/26" maxLength={40} required={ratingContextRequired} /></ObservationField>
            <ObservationField label="比赛" required={ratingContextRequired} wide><Input value={draft.match} onChange={(event) => updateDraft("match", event.target.value)} placeholder="例如 Bayern vs Example FC" maxLength={180} required={ratingContextRequired} /></ObservationField>
            <ObservationField label="观看范围" required={ratingContextRequired}><select className={selectClassName} value={draft.viewingScope} onChange={(event) => updateDraft("viewingScope", event.target.value)} required={ratingContextRequired}><option value="">未知 / 未记录</option>{Object.entries(PlayerObservationViewingScopeDefinitions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></ObservationField>
            <ObservationField label="观看分钟范围"><Input value={draft.viewedMinuteRanges} onChange={(event) => updateDraft("viewedMinuteRanges", event.target.value)} placeholder="例如 1–30、60–90 分钟" maxLength={120} /></ObservationField>
            <ObservationField label="比赛分钟"><Input type="number" min={0} max={150} value={draft.matchMinute} onChange={(event) => updateDraft("matchMinute", event.target.value)} placeholder="可选" /></ObservationField>
            <ObservationField label="表现优势" required wide><Textarea rows={3} value={draft.strengths} onChange={(event) => updateDraft("strengths", event.target.value)} placeholder="每行一条，只记录你亲眼观察到的内容" required /></ObservationField>
            <ObservationField label="待核实风险" wide><Textarea rows={3} value={draft.risks} onChange={(event) => updateDraft("risks", event.target.value)} placeholder="每行一条；没有明确风险时可以留空" /></ObservationField>
            <ObservationField label="具体比赛观察" required wide><Textarea rows={4} value={draft.evidenceNote} onChange={(event) => updateDraft("evidenceNote", event.target.value)} placeholder="记下比赛场景、动作和结果；至少 20 个字符。它仍是你的主观观察，不等于统计事实。" required /></ObservationField>

            <details className="group rounded-lg border bg-card p-4 sm:col-span-2">
              <summary className="cursor-pointer list-inside text-sm font-medium">结构化能力观察 <span className="ml-1 text-xs font-normal text-muted-foreground">可选 · 按本场样本记录</span></summary>
              <p className="mb-0 mt-2 text-xs leading-5 text-muted-foreground">这是尚未校准的项目暂定量表，不代表观察者之间已经一致。填写评分时，请同时补全赛事、赛季、比赛和观看范围；无证据时留空。不同记录不会自动平均或计入适配分。</p>
              <div className="mt-4 space-y-3">
                {draft.ratings.map((rating, index) => {
                  const dimension = PlayerObservationDimensionSchema.safeParse(rating.dimension);
                  const definition = dimension.success ? PlayerObservationDimensionDefinitions[dimension.data] : undefined;
                  return <fieldset className="space-y-4 rounded-lg border bg-muted/30 p-3 sm:p-4" key={`${rating.dimension}-${index}`}>
                    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(100px,.6fr)_auto]">
                      <ObservationField label="能力维度" required><select className={selectClassName} value={rating.dimension} onChange={(event) => updateRating(index, "dimension", event.target.value)}>{Object.entries(PlayerObservationDimensionDefinitions).map(([key, value]) => <option key={key} value={key}>{value.label} · {value.phase === "in_possession" ? "有球" : value.phase === "out_of_possession" ? "无球" : "转换"}</option>)}</select></ObservationField>
                      <ObservationField label="主观档位" required><select className={selectClassName} value={rating.rating} onChange={(event) => updateRating(index, "rating", event.target.value)} required><option value="">选择 1–5</option><option value="1">1 · 明显短板</option><option value="2">2 · 偏弱</option><option value="3">3 · 一般 / 参差</option><option value="4">4 · 经常展现优势</option><option value="5">5 · 多次突出</option></select></ObservationField>
                      <ObservationField label="比赛分钟"><Input type="number" min={0} max={150} value={rating.matchMinute} onChange={(event) => updateRating(index, "matchMinute", event.target.value)} placeholder="可选" /></ObservationField>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => removeRating(index)}><Trash2 aria-hidden="true" />移除此项</Button>
                    </div>
                    <ObservationField label={`支持此判断的具体场景${definition ? ` · ${definition.description}` : ""}`} required><Textarea rows={2} value={rating.evidence} onChange={(event) => updateRating(index, "evidence", event.target.value)} placeholder="描述对手压力、球员动作、结果；至少 20 个字符" required /></ObservationField>
                  </fieldset>;
                })}
                <Button type="button" variant="outline" size="sm" onClick={addRating} disabled={draft.ratings.length >= 8}><Plus aria-hidden="true" />添加一个维度</Button>
              </div>
            </details>
            <ObservationField label="参考链接" wide><Input type="url" value={draft.sourceReferenceUrl} onChange={(event) => updateDraft("sourceReferenceUrl", event.target.value)} placeholder="可选，仅作为出处链接；不会自动访问或抓取" /></ObservationField>
          </div>

          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 text-sm font-medium">保存与使用权限</legend>
            <label className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50">
              <input className="mt-1 size-4 accent-primary" type="checkbox" checked={draft.allowPersistentStorage} onChange={(event) => changeStoragePermission(event.target.checked)} />
              <span className="space-y-1"><strong className="block text-sm font-medium">允许保存在这台设备上</strong><small className="block text-xs leading-5 text-muted-foreground">记录写入本机项目数据目录；取消已保存记录的授权会删除该记录。</small></span>
            </label>
            <label className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50">
              <input className="mt-1 size-4 accent-primary" type="checkbox" checked={draft.allowAiProcessing} onChange={(event) => updateDraft("allowAiProcessing", event.target.checked)} />
              <span className="space-y-1"><strong className="block text-sm font-medium">允许加入 Agent 检索与模型分析</strong><small className="block text-xs leading-5 text-muted-foreground">若模型或 embedding 配置为远程服务，观察文本可能发送给该服务；关闭后会从当前检索索引移除。</small></span>
            </label>
          </fieldset>

          {error && <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert>}
          {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
          <Separator />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {selectedRecord && <Button type="button" variant="outline" className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => void removeSelected()} disabled={saving}><Trash2 aria-hidden="true" />删除记录</Button>}
            <Button type="submit" disabled={saving}><Save aria-hidden="true" />{saving ? "正在保存…" : "保存观察"}</Button>
          </div>
        </form>
      </div>
    </DialogContent>
  </Dialog>;
}
