import { showcaseClasses } from "../showcase-classes";

const scenarios = [
  {
    number: "01",
    outcomeSymbol: "↗",
    eyebrow: "EVIDENCE GAP · REPAIR",
    title: "前锋替代者调查",
    full: { score: "29/29", runs: "3/3 全部通过", evidence: "2 条 / 次" },
    bypass: { score: "28/29", runs: "0/3 全部通过", evidence: "1 条 / 次" },
    action: "补齐 1 条证据引用",
    detail: "三次旁路都未通过能力证据检查；复核没有改变候选名单。",
    pairedFact: "候选名单与 Planner / 工具轨迹 3/3 相同",
  },
  {
    number: "02",
    outcomeSymbol: "=",
    eyebrow: "GROUNDED REPORT · NO CHANGE",
    title: "U23 中场补强",
    full: { score: "30/30", runs: "3/3 全部通过", evidence: "6 条 / 次" },
    bypass: { score: "30/30", runs: "3/3 全部通过", evidence: "6 条 / 次" },
    action: "证据完整，名单不变",
    detail: "复核通过，问题 0、修复 0；旁路前后候选、引用和工具轨迹均相同。",
    pairedFact: "0 次追问；每组评估 20 人、推荐 3 人",
  },
] as const;

export function ShowcaseReviewerAblation() {
  return <section className={showcaseClasses("showcase-reviewer-ablation")} aria-labelledby="showcase-reviewer-ablation-title">
    <header className={showcaseClasses("reviewer-ablation-heading")}>
      <div>
        <p className={showcaseClasses("eyebrow")}>CONTROLLED ABLATION · 2026-10-10</p>
        <h2 id="showcase-reviewer-ablation-title">有证据缺口时修复，证据完整时不干预。</h2>
        <p>只切换确定性证据复核门；Planner、工具和 Wyscout 历史快照保持一致。每个场景做三组配对。</p>
      </div>
      <div className={showcaseClasses("reviewer-ablation-case-count")} aria-label="两个场景，每个场景三组配对">
        <strong>02</strong>
        <span>distinct cases</span>
        <small>3 matched pairs each</small>
        <small>Qwen 3.5 9B · Wyscout 2017/18</small>
      </div>
    </header>

    <div className={showcaseClasses("reviewer-ablation-scenarios")}>
      {scenarios.map((scenario) => <article className={showcaseClasses("reviewer-ablation-scenario")} key={scenario.number}>
        <header className={showcaseClasses("reviewer-ablation-scenario-heading")}>
          <span className={showcaseClasses("reviewer-ablation-scenario-number")}>{scenario.number}</span>
          <div>
            <p>{scenario.eyebrow}</p>
            <h3>{scenario.title}</h3>
          </div>
          <span className={showcaseClasses("reviewer-ablation-repeat")}>3 ×</span>
        </header>

        <div className={showcaseClasses("reviewer-ablation-comparison")} aria-label={`${scenario.title}完整复核与旁路对比`}>
          <div className={showcaseClasses("reviewer-ablation-arm", "is-enabled")}>
            <span>FULL HARNESS · 复核开启</span>
            <strong>{scenario.full.score}</strong>
            <small>{scenario.full.runs}</small>
          </div>
          <span className={showcaseClasses("reviewer-ablation-versus")} aria-hidden="true">vs</span>
          <div className={showcaseClasses("reviewer-ablation-arm", "is-bypassed")}>
            <span>REVIEW BYPASSED · 复核旁路</span>
            <strong>{scenario.bypass.score}</strong>
            <small>{scenario.bypass.runs}</small>
          </div>
        </div>

        <div className={showcaseClasses("reviewer-ablation-observation")}>
          <span aria-hidden="true">{scenario.outcomeSymbol}</span>
          <div>
            <strong>{scenario.action}</strong>
            <p>{scenario.detail}</p>
          </div>
        </div>

        <footer className={showcaseClasses("reviewer-ablation-scenario-facts")}>
          <span><small>焦点证据引用 · 完整 → 旁路</small><b>{scenario.full.evidence} → {scenario.bypass.evidence}</b></span>
          <span><small>配对观察</small><b>{scenario.pairedFact}</b></span>
        </footer>
      </article>)}
    </div>

    <p className={showcaseClasses("reviewer-ablation-caveat")}>这是同一模型和历史快照上的两个场景，每个场景重复三次；重复运行不等于更多独立场景。结果说明本次复核修复了一个证据引用缺口，并在无缺口时保持原结果。没有真人球探标签，候选排序质量仍未评估；这也不是 LangGraph 与其他框架的比较。</p>
  </section>;
}
