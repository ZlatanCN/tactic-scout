import "./ShowcaseMethodologyRagAblation.css";

const arms = [
  {
    className: "available",
    heading: "方法资料可用",
    retrieval: "2",
    retrievalLabel: "片段 · 1 个来源",
    report: "2",
    reportLabel: "片段进入报告",
    result: "3/3",
    resultLabel: "来源可追溯检查通过",
  },
  {
    className: "suppressed",
    heading: "屏蔽方法资料",
    retrieval: "0",
    retrievalLabel: "片段 · 0 个来源",
    report: "0",
    reportLabel: "方法片段进入报告",
    result: "3/3",
    resultLabel: "来源约束检查通过",
  },
] as const;

export function ShowcaseMethodologyRagAblation() {
  return <section className="showcase-rag-ablation" aria-labelledby="showcase-rag-title">
    <header className="rag-ablation-heading">
      <div>
        <p className="eyebrow">METHODOLOGY RAG · FULL-GRAPH ABLATION · 2026-10-10</p>
        <h2 id="showcase-rag-title">方法证据进入了报告，但没有改变这次候选顺序。</h2>
        <p>同一个 LangGraph 跑三组配对：一组正常读取方法资料，另一组只屏蔽方法语料。</p>
      </div>
      <aside className="rag-ablation-proof" aria-label="整图 Harness 验收结果">
        <span>FULL GRAPH RUNS</span>
        <strong>6<span> / 6</span></strong>
        <small>每次均通过 29/29 项检查</small>
      </aside>
    </header>

    <div className="rag-ablation-arms">
      {arms.map((arm) => <article className={`rag-ablation-arm is-${arm.className}`} key={arm.className}>
        <header><span aria-hidden="true">{arm.className === "available" ? "↗" : "—"}</span><h3>{arm.heading}</h3></header>
        <div className="rag-ablation-flow">
          <div><strong>{arm.retrieval}</strong><span>{arm.retrievalLabel}</span><small>检索结果</small></div>
          <i aria-hidden="true">→</i>
          <div><strong>{arm.report}</strong><span>{arm.reportLabel}</span><small>最终报告</small></div>
        </div>
        <p className="rag-ablation-check"><b>{arm.result}</b><span>{arm.resultLabel}</span></p>
      </article>)}
    </div>

    <div className="rag-ablation-pair-note">
      <span aria-hidden="true">＝</span>
      <p><strong>三组配对的非方法调查轨迹和候选顺序相同。</strong> 观察到的是方法证据从检索传递到报告，没有观察到候选推荐变化。</p>
    </div>

    <details className="rag-ablation-method">
      <summary>模型、数据快照与实验边界</summary>
      <div>
        <p>本机 Qwen 3.5 9B；拜仁替代者场景；Wyscout 2017/18 curated 快照，SHA-256：<code>6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f</code>。两臂使用同一需求、补答、LangGraph 策略、Reviewer 和工具预算；消融臂只让方法语料检索为空。</p>
        <p>这是一个冻结场景的三组配对机制检查。Harness 通过不表示推荐正确；该实验没有真人排序标签，不能证明 RAG 普遍提升球探判断或推荐质量。</p>
      </div>
    </details>
  </section>;
}
