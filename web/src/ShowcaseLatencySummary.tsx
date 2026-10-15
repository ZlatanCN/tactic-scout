import { showcaseClasses } from "./showcase-classes";

const summary = {
  date: "2026-10-10",
  scenario: "同一前锋替代者调查",
  model: "Qwen 3.5 9B · Ollama",
  runCount: 3,
  checksPerRun: "29/29",
  endToEnd: { p50: 64_953, p95: 164_455 },
  runs: [
    { label: "运行 01", elapsedMs: 164_455 },
    { label: "运行 02", elapsedMs: 64_953 },
    { label: "运行 03", elapsedMs: 56_653 },
  ],
  planner: [
    { operation: "finish", sampleCount: 3, p50: 25_059, p95: 68_813 },
    { operation: "search_candidates", sampleCount: 9, p50: 10_531, p95: 27_755 },
    { operation: "search_methodology", sampleCount: 3, p50: 7_530, p95: 28_814 },
  ],
  tools: [
    { operation: "evaluate_candidates", sampleCount: 9, p50: 9, p95: 32 },
    { operation: "search_candidates", sampleCount: 9, p50: 2, p95: 291 },
    { operation: "search_methodology", sampleCount: 3, p50: 95, p95: 1_405 },
    { operation: "search_player_reports", sampleCount: 9, p50: 3, p95: 8 },
  ],
} as const;

function duration(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)} 秒` : `${ms} 毫秒`;
}

function relativeBarWidth(ms: number, max: number): string {
  return `${Math.max(1, (ms / max) * 100)}%`;
}

function OperationGroup({
  title,
  eyebrow,
  rows,
  scale,
}: {
  title: string;
  eyebrow: string;
  rows: readonly { operation: string; sampleCount: number; p50: number; p95: number }[];
  scale: string;
}) {
  const maxP95 = Math.max(...rows.map(({ p95 }) => p95));

  return <section className={showcaseClasses("latency-operation-group")} aria-label={title}>
    <div className={showcaseClasses("latency-group-heading")}>
      <div><p>{eyebrow}</p><h3>{title}</h3></div>
      <span>{scale}</span>
    </div>
    <ul className={showcaseClasses("latency-operation-list")}>
      {rows.map((row) => <li className={showcaseClasses("latency-operation-row")} key={row.operation}>
        <div className={showcaseClasses("latency-operation-label")}>
          <code>{row.operation}</code>
          <small>{row.sampleCount} 次事件 · p50 {duration(row.p50)}</small>
        </div>
        <div className={showcaseClasses("latency-operation-track")} aria-hidden="true">
          <span style={{ width: relativeBarWidth(row.p95, maxP95) }} />
        </div>
        <strong>{duration(row.p95)}<small> p95</small></strong>
      </li>)}
    </ul>
  </section>;
}

export function ShowcaseLatencySummary() {
  const longestRun = Math.max(...summary.runs.map(({ elapsedMs }) => elapsedMs));

  return <section className={showcaseClasses("showcase-latency")} aria-labelledby="showcase-latency-title">
    <header className={showcaseClasses("showcase-latency-lead")}>
      <div>
        <p className={showcaseClasses("eyebrow")}>HARNESS LATENCY · {summary.date}</p>
        <h2 id="showcase-latency-title">这 {summary.runCount} 次运行的长等待主要落在 Planner 决策。</h2>
        <p>整轮调查最长观测到 164.5 秒；Planner 决策事件的 p95 为 27.8–68.8 秒，工具执行事件的 p95 为 8 毫秒至 1.4 秒。</p>
      </div>
      <div className={showcaseClasses("showcase-latency-headline")} aria-label={`${summary.runCount} 次整轮调查的 p95：${duration(summary.endToEnd.p95)}`}>
        <small>整轮调查 · {summary.runCount} 次运行 p95</small>
        <strong>{duration(summary.endToEnd.p95)}</strong>
        <span>p50 {duration(summary.endToEnd.p50)}</span>
      </div>
    </header>

    <div className={showcaseClasses("showcase-latency-run-section")}>
      <div className={showcaseClasses("showcase-latency-subheading")}>
        <h3>先看每次完整调查</h3>
        <p>{summary.scenario} · {summary.model} · 每次 {summary.checksPerRun} 行为检查通过</p>
      </div>
      <ol className={showcaseClasses("showcase-latency-runs")} aria-label={`${summary.runCount} 次整轮调查的观测时长`}>
        {summary.runs.map((run) => <li className={showcaseClasses("showcase-latency-run")} key={run.label}>
          <span>{run.label}</span>
          <div className={showcaseClasses("showcase-latency-run-track")} aria-hidden="true">
            <span style={{ width: relativeBarWidth(run.elapsedMs, longestRun) }} />
          </div>
          <strong>{duration(run.elapsedMs)}</strong>
        </li>)}
      </ol>
    </div>

    <div className={showcaseClasses("showcase-latency-subheading", "showcase-latency-breakdown-heading")}>
      <h3>再拆开 Planner 决策与实际工具</h3>
      <p>每组单独缩放条形图；操作事件分布不可相加为整轮耗时。</p>
    </div>
    <div className={showcaseClasses("showcase-latency-breakdown")}>
      <OperationGroup eyebrow="MODEL-BACKED DECISIONS" title="Planner" scale="组内比例尺 · 秒" rows={summary.planner} />
      <OperationGroup eyebrow="LOCAL TOOL EXECUTION" title="工具" scale="组内比例尺 · 毫秒至秒" rows={summary.tools} />
    </div>

    <p className={showcaseClasses("showcase-latency-caveat")}>
      Planner 耗时包含模型请求处理和本地动作校验，不等于纯推理时间。整轮调查的 p95 基于 {summary.runCount} 次运行，因此等于这组中的最大观测值；每种操作的 p50/p95 则来自该操作各自的事件样本。Planner 与工具事件不能相加推导端到端耗时。这是小样本延迟记录，不代表长期性能或球员推荐质量。数据来自 curated Wyscout 2017/18 历史数据，本节与上方 2026-10-09 的单次录制运行是不同批次。
    </p>
  </section>;
}
