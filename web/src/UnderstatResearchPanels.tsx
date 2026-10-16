import type { UnderstatMatchResearch, UnderstatPlayerResearch, UnderstatTeamResearch } from "../../src/domain/schemas.js";

const number = (value: number | null | undefined, digits = 2) => value === null || value === undefined ? "未知" : Number.isInteger(value) ? value.toLocaleString() : value.toFixed(digits);
const text = (value: string | null | undefined) => value?.trim() || "未知";

function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number | null>> }) {
  if (rows.length === 0) return <p className="m-0 text-xs text-muted-foreground">来源未提供这组记录。</p>;
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr>{headers.map((header) => <th className="border-b px-2 py-2 font-semibold text-muted-foreground" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr className="border-b last:border-0" key={rowIndex}>{row.map((cell, columnIndex) => <td className="px-2 py-2 align-top tabular-nums" key={columnIndex}>{cell === null ? "未知" : cell}</td>)}</tr>)}</tbody></table></div>;
}

function ResearchSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-2"><h4 className="m-0 text-xs font-semibold">{title}</h4>{children}</section>;
}

export function UnderstatPlayerResearchPanel({ research }: { research: UnderstatPlayerResearch }) {
  const matchShots = research.shots ?? [];
  return <details className="mt-3 rounded-lg border bg-card">
    <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">Understat 球员档案 · 位置、赛季与进攻参与</summary>
    <div className="space-y-4 border-t p-3">
      <p className="m-0 text-xs leading-5 text-muted-foreground">{research.team} · {research.competition} · {research.season} · 读取于 {text(research.retrievedAt)}。以下为来源表现记录；位置不等同于固定职责，缺项表示未知。</p>
      {research.positions && <ResearchSection title="按赛季与来源位置拆分"><DataTable headers={["赛季", "位置代码", "分钟", "出场", "进球", "射门", "xG", "助攻", "xA", "关键传球", "npxG", "xGChain", "xGBuildup"]} rows={research.positions.map((item) => [item.season, item.code, number(item.minutes, 0), number(item.games, 0), number(item.goals, 0), number(item.shots, 0), number(item.xG), number(item.assists, 0), number(item.xA), number(item.keyPasses, 0), number(item.npxG), number(item.xGChain), number(item.xGBuildup)])} /></ResearchSection>}
      {research.history && <ResearchSection title="赛季趋势"><DataTable headers={["赛季", "球队", "位置", "分钟", "进球", "xG", "助攻", "xA", "关键传球", "xGChain", "xGBuildup"]} rows={research.history.map((item) => [item.season, text(item.team), text(item.position), number(item.minutes, 0), number(item.goals, 0), number(item.xG), number(item.assists, 0), number(item.xA), number(item.keyPasses, 0), number(item.xGChain), number(item.xGBuildup)])} /></ResearchSection>}
      {research.recent && <ResearchSection title="近期比赛"><DataTable headers={["日期", "对阵", "位置", "分钟", "进球", "xG", "助攻", "xA", "关键传球", "xGChain"]} rows={research.recent.map((item) => [text(item.date), `${text(item.homeTeam)} ${number(item.homeGoals, 0)}–${number(item.awayGoals, 0)} ${text(item.awayTeam)}`, text(item.position), number(item.minutes, 0), number(item.goals, 0), number(item.xG), number(item.assists, 0), number(item.xA), number(item.keyPasses, 0), number(item.xGChain)])} /></ResearchSection>}
      {research.shotProfile && <ResearchSection title="射门与进攻情境分布"><DataTable headers={["赛季", "分组", "类别", "射门", "进球", "xG", "npxG", "助攻", "关键传球"]} rows={research.shotProfile.map((item) => [item.season, item.dimension, item.category, number(item.shots, 0), number(item.goals, 0), number(item.xG), number(item.npxG), number(item.assists, 0), number(item.keyPasses, 0)])} /></ResearchSection>}
      {matchShots.length > 0 && <details className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">逐次射门记录 · {matchShots.length} 条</summary><div className="border-t p-2"><DataTable headers={["日期", "分钟", "结果", "xG", "情境", "射门类型", "最后动作", "助攻者"]} rows={matchShots.map((item) => [text(item.date), text(item.minute), text(item.result), number(item.xG), text(item.situation), text(item.shotType), text(item.lastAction), text(item.assistedBy)])} /></div></details>}
      <ul className="m-0 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{research.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
      <a className="text-xs text-primary underline underline-offset-4" href={research.sourceUrl} target="_blank" rel="noreferrer">打开 Understat 球员来源页</a>
    </div>
  </details>;
}

export function UnderstatTeamResearchPanel({ research }: { research: UnderstatTeamResearch }) {
  return <details className="rounded-lg border bg-card"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">球队背景 · Understat {research.season}</summary><div className="space-y-4 border-t p-3">
    <p className="m-0 text-xs text-muted-foreground">{research.team} · {research.competition}。这是球队比赛环境与统计拆分，不代表完整注册名单，也不直接衡量个人能力。</p>
    <ResearchSection title="近期比赛"><DataTable headers={["日期", "对阵", "比分", "xG 对照", "结果"]} rows={research.recentMatches.map((item) => [text(item.date), `${text(item.homeTeam)} vs ${text(item.awayTeam)}`, `${number(item.homeGoals, 0)}–${number(item.awayGoals, 0)}`, `${number(item.homeXG)}–${number(item.awayXG)}`, text(item.result)])} /></ResearchSection>
    <ResearchSection title="球队统计拆分"><DataTable headers={["维度", "类别", "射门", "进球", "xG", "对方射门", "对方进球", "对方 xG"]} rows={research.statistics.map((item) => [item.dimension, item.category, number(item.shots, 0), number(item.goals, 0), number(item.xG), number(item.againstShots, 0), number(item.againstGoals, 0), number(item.againstXG)])} /></ResearchSection>
    <ResearchSection title="球队赛季球员统计"><DataTable headers={["球员", "位置", "出场", "分钟", "进球", "xG", "助攻", "xA", "关键传球"]} rows={research.players.map((item) => [item.name, text(item.position), number(item.games, 0), number(item.minutes, 0), number(item.goals, 0), number(item.xG), number(item.assists, 0), number(item.xA), number(item.keyPasses, 0)])} /></ResearchSection>
    <ul className="m-0 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{research.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
    <a className="text-xs text-primary underline underline-offset-4" href={research.sourceUrl} target="_blank" rel="noreferrer">打开 Understat 球队来源页</a>
  </div></details>;
}

export function UnderstatMatchResearchPanel({ research }: { research: UnderstatMatchResearch }) {
  return <details className="rounded-lg border bg-card"><summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold">比赛细查 · {text(research.homeTeam)} {number(research.score.home, 0)}–{number(research.score.away, 0)} {text(research.awayTeam)}</summary><div className="space-y-4 border-t p-3">
    <p className="m-0 text-xs text-muted-foreground">{text(research.date)} · Understat 比赛记录；替补登场/离场事件不能直接推断实际出场分钟。</p>
    <ResearchSection title="比赛名单"><DataTable headers={["球队", "球员", "位置", "顺序", "分钟", "进球", "射门", "xG", "助攻", "关键传球", "黄牌", "红牌"]} rows={research.rosters.map((item) => [item.team === "home" ? text(research.homeTeam) : text(research.awayTeam), text(item.name), text(item.position), number(item.positionOrder, 0), number(item.minutes, 0), number(item.goals, 0), number(item.shots, 0), number(item.xG), number(item.assists, 0), number(item.keyPasses, 0), number(item.yellowCards, 0), number(item.redCards, 0)])} /></ResearchSection>
    <ResearchSection title="射门记录"><DataTable headers={["球队", "球员", "分钟", "结果", "xG", "情境", "类型", "最后动作", "助攻者"]} rows={research.shots.map((item) => [item.team === "home" ? text(research.homeTeam) : text(research.awayTeam), text(item.player), text(item.minute), text(item.result), number(item.xG), text(item.situation), text(item.shotType), text(item.lastAction), text(item.assistedBy)])} /></ResearchSection>
    <ul className="m-0 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{research.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
    <a className="text-xs text-primary underline underline-offset-4" href={research.sourceUrl} target="_blank" rel="noreferrer">打开 Understat 比赛来源页</a>
  </div></details>;
}
