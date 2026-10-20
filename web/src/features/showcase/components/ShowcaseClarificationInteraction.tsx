import { showcaseClasses } from "../showcase-classes";

const cases = [
  {
    number: "01",
    tag: "需求明确 · 无需追问",
    title: "明确的 U23 中场需求",
    description: "用户已经给出球队、位置、年龄范围和能力偏好。",
    arms: [
      { label: "脚本答复可用", status: "3 / 3 完成", questions: "0 次追问", checks: "31 / 31 检查" },
      { label: "不提供脚本答复", status: "3 / 3 完成", questions: "0 次追问", checks: "31 / 31 检查" },
    ],
    outcome: "两臂都直接完成调查，没有为清楚需求额外制造问题。",
    paths: [
      { label: "答复可用", steps: ["需求已明确", "检索方法与候选", "评估并报告"] },
      { label: "不提供答复", steps: ["需求已明确", "检索方法与候选", "评估并报告"] },
    ],
  },
  {
    number: "02",
    tag: "职责模糊 · 暂停与恢复",
    title: "替代者职责尚未确定",
    description: "参考球员能圈定大致位置，但具体职责会改变候选方向。",
    arms: [
      { label: "匹配问题后提供答复", status: "3 / 3 完成", questions: "2 问 · 2 答", checks: "29 / 29 检查" },
      { label: "首次追问后不答复", status: "3 / 3 安全暂停", questions: "1 问后 needs_input", checks: "9 / 9 暂停检查" },
    ],
    outcome: "正常交互臂先查证据，再围绕职责和扩位许可追问；图在同一案件恢复。答案被扣留时，LangGraph 停在首次中断，没有继续调用工具或伪造报告。",
    paths: [
      { label: "答复可用", steps: ["初步检索", "职责追问", "同案恢复", "报告"] },
      { label: "不提供答复", steps: ["初步检索", "职责追问", "interrupt · 等待用户"] },
    ],
  },
] as const;

function CasePath({ label, steps }: { label: string; steps: readonly string[] }) {
  return <div className={showcaseClasses("clarification-path")}>
    <span>{label}</span>
    <ol aria-label={label}>
      {steps.map((step, index) => <li key={step} className={index === steps.length - 1 ? showcaseClasses("is-end") : undefined}>
        <i aria-hidden="true">{index === steps.length - 1 ? "✓" : String(index + 1).padStart(2, "0")}</i>
        <b>{step}</b>
      </li>)}
    </ol>
  </div>;
}

export function ShowcaseClarificationInteraction() {
  return <section className={showcaseClasses("showcase-clarification")} aria-labelledby="showcase-clarification-title">
    <header className={showcaseClasses("clarification-lead")}>
      <div className={showcaseClasses("clarification-lead-copy")}>
        <p className={showcaseClasses("eyebrow")}>LangGraph 中断 · 配对检查 · 2026-10-10</p>
        <h2 id="showcase-clarification-title">需求清楚时直接完成；职责有歧义时，先调查再追问。</h2>
        <p>两个冻结场景、每个三组配对：正常交互下，图会在同一案件里暂停并恢复；不给脚本答复时，它会停在真实的用户中断处。</p>
      </div>
      <aside className={showcaseClasses("clarification-proof")} aria-label="交互消融摘要">
        <span>Harness 检查</span>
        <strong>12<span> / 12</span></strong>
        <small>预注册行为检查通过</small>
        <div><b>02</b> 个场景 <i>·</i> <b>03</b> 组配对 / 场景</div>
      </aside>
    </header>

    <div className={showcaseClasses("clarification-case-grid")}>
      {cases.map((scenario) => <article className={showcaseClasses("clarification-case")} key={scenario.number}>
        <header className={showcaseClasses("clarification-case-heading")}>
          <span>{scenario.number}</span>
          <div><p>{scenario.tag}</p><h3>{scenario.title}</h3><small>{scenario.description}</small></div>
        </header>

        <div className={showcaseClasses("clarification-arms")}>
          {scenario.arms.map((arm) => <section className={showcaseClasses("clarification-arm")} key={arm.label}>
            <span>{arm.label}</span>
            <strong>{arm.status}</strong>
            <div><b>{arm.questions}</b><b>{arm.checks}</b></div>
          </section>)}
        </div>

        <div className={showcaseClasses("clarification-outcome")}><span aria-hidden="true">↳</span><p>{scenario.outcome}</p></div>
        <div className={showcaseClasses("clarification-paths")}>
          {scenario.paths.map((path) => <CasePath key={path.label} {...path} />)}
        </div>
      </article>)}
    </div>

    <details className={showcaseClasses("clarification-method")}>
      <summary>展开实验控制与结果边界</summary>
      <div>
        <p>两臂固定 Qwen 3.5 9B、LangGraph、Planner / Reviewer、工具预算、方法知识库和 Wyscout 2017/18 curated 快照；只改变脚本答复是否可用，运行顺序在配对间交错。完整实验记录 SHA-256：<code>6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f</code>。</p>
        <p>三次重复只覆盖这两个冻结场景。它不评球员排序准确性，不是通用的提问策略评测，也不是 LangGraph 与其他框架的比较。球员身份和原始对话/轨迹均未展示。</p>
      </div>
    </details>
  </section>;
}
