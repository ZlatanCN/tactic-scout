import "./ShowcaseAskPolicyAblation.css";

const scenarios = [
  {
    number: "01",
    label: "关键职责未明确",
    title: "替代者需要先确认场上职责",
    summary: "Agent 先检查候选和方法资料，再判断是否能安全继续。",
    enabled: {
      heading: "允许追问 · 接收匹配答复",
      outcome: "3/3 完成报告",
      detail: "2 次意图匹配澄清 · 同案恢复 · 10 次工具调用 · 29/29 检查",
      tone: "enabled",
    },
    disabled: {
      heading: "禁用追问 · 不提供答复",
      outcome: "3/3 安全暂停",
      detail: "1 次图内追问决策被抑制 · 未展示问题 · 0 次补答 · 2 次工具调用 · 无报告 · 7/7 检查",
      tone: "disabled",
    },
    paths: [
      { label: "正常交互", steps: ["先查证据", "确认职责", "同案继续", "形成报告"] },
      { label: "禁用追问", steps: ["先查证据", "发现关键缺项", "安全暂停 · 无报告"] },
    ],
  },
  {
    number: "02",
    label: "清晰需求对照",
    title: "需求明确时，两臂都直接调查",
    summary: "位置、年龄和能力要求已明确，不需要中途追加条件。",
    enabled: {
      heading: "允许追问 · 接收匹配答复",
      outcome: "3/3 完成报告",
      detail: "0 次追问 · 0 次补答 · 6 次工具调用 · 31/31 检查",
      tone: "enabled",
    },
    disabled: {
      heading: "禁用追问 · 不提供答复",
      outcome: "3/3 完成报告",
      detail: "0 次追问 · 0 次补答 · 6 次工具调用 · 31/31 检查",
      tone: "disabled",
    },
    paths: [
      { label: "正常交互", steps: ["读取需求", "调查候选", "形成报告"] },
      { label: "禁用追问", steps: ["读取需求", "调查候选", "形成报告"] },
    ],
  },
] as const;

function ScenarioPath({ label, steps }: { label: string; steps: readonly string[] }) {
  return <div className="ask-policy-path">
    <span>{label}</span>
    <ol aria-label={label}>
      {steps.map((step, index) => <li key={step} className={index === steps.length - 1 ? "is-end" : ""}>
        <i aria-hidden="true">{index === steps.length - 1 ? "✓" : String(index + 1).padStart(2, "0")}</i>
        <b>{step}</b>
      </li>)}
    </ol>
  </div>;
}

export function ShowcaseAskPolicyAblation() {
  return <section className="showcase-ask-policy" aria-labelledby="showcase-ask-policy-title">
    <header className="ask-policy-lead">
      <div className="ask-policy-lead-copy">
        <p className="eyebrow">ASK-POLICY ABLATION · 2026-10-10</p>
        <h2 id="showcase-ask-policy-title">缺关键职责就停下，需求说清楚就继续。</h2>
        <p>同一套 LangGraph 分别运行正常交互和禁用追问控制，观察 Agent 会不会猜职责，或把清晰需求卡住。</p>
      </div>
      <aside className="ask-policy-proof" aria-label="配对运行结果">
        <span>PAIRED HARNESS RUNS</span>
        <strong>12<span> / 12</span></strong>
        <small>全部通过各自预设的行为检查</small>
        <div><b>02</b> 个场景 <i>·</i> <b>03</b> 组配对 / 场景</div>
      </aside>
    </header>

    <div className="ask-policy-scenario-grid">
      {scenarios.map((scenario) => <article className="ask-policy-scenario" key={scenario.number}>
        <header className="ask-policy-scenario-heading">
          <span>{scenario.number}</span>
          <div><p>{scenario.label}</p><h3>{scenario.title}</h3><small>{scenario.summary}</small></div>
        </header>

        <div className="ask-policy-arms">
          {[scenario.enabled, scenario.disabled].map((arm) => <section className={`ask-policy-arm is-${arm.tone}`} key={arm.heading}>
            <span>{arm.heading}</span>
            <strong>{arm.outcome}</strong>
            <p>{arm.detail}</p>
          </section>)}
        </div>

        <div className="ask-policy-paths">
          {scenario.paths.map((path) => <ScenarioPath key={path.label} {...path} />)}
        </div>
      </article>)}
    </div>

    <div className="ask-policy-architecture-note">
      <span aria-hidden="true">↳</span>
      <p><strong>这组对照控制的是整张图的追问边界。</strong>首个职责追问源于 LangGraph 确定性策略门，不是 Planner 的模型动作；只禁用 Planner 仍会触发该策略门，无法构成有效对照。</p>
    </div>

    <details className="ask-policy-method">
      <summary>实验控制与结论边界</summary>
      <div>
        <p>固定 Qwen 3.5 9B、LangGraph、Reviewer、工具预算、知识库和同一份 Wyscout 2017/18 curated 快照（SHA-256：`6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`）。正常臂只在问题符合预登记意图后收到答复；禁问臂在追问边界命中后进入固定 `needs_input` 暂停，不展示生成的问题，也不接收答复。</p>
        <p>两臂同时改变是否追问与是否获得答案，因此报告差异不能只归因于提问本身。三个配对只覆盖两个冻结案例，不评推荐排序，不证明通用澄清质量，也不是 LangGraph 与其他框架的对比。</p>
      </div>
    </details>
  </section>;
}
