import { showcaseClasses } from "./showcase-classes";

export function ShowcaseEvidenceEvaluatorAblation() {
  return <section className={showcaseClasses("showcase-evaluator-ablation")} aria-labelledby="showcase-evaluator-ablation-title">
    <header className={showcaseClasses("evaluator-ablation-heading")}>
      <div>
        <p className={showcaseClasses("eyebrow")}>EVIDENCE EVALUATOR · FULL-GRAPH ABLATION · 2026-10-11</p>
        <h2 id="showcase-evaluator-ablation-title">这组实验里，有证据时报告有据可查；屏蔽后 Agent 没有推荐。</h2>
        <p>同一张 LangGraph、同一组工具和 Reviewer，只切换候选表现评估器是否返回能力证据。</p>
      </div>
      <aside className={showcaseClasses("evaluator-ablation-pair-count")} aria-label="一个冻结场景，三组配对运行">
        <strong>3×</strong>
        <span>matched pairs</span>
        <small>one frozen scenario</small>
        <small>Qwen 3.5 9B</small>
      </aside>
    </header>

    <div className={showcaseClasses("evaluator-ablation-arms")}>
      <article className={showcaseClasses("evaluator-ablation-arm", "is-enabled")} aria-labelledby="evaluator-enabled-title">
        <header><span aria-hidden="true">↗</span><h3 id="evaluator-enabled-title">评估器开启</h3></header>
        <div className={showcaseClasses("evaluator-ablation-stats")}>
          <div><strong>3/3</strong><span>整图通过</span><small>每次 31/31 检查</small></div>
          <div><strong>194</strong><span>指标值 / 次</span><small>评估 20 名候选</small></div>
          <div><strong>20/20</strong><span>候选有直接指标</span><small>覆盖两项请求能力</small></div>
          <div><strong>3 · 6</strong><span>推荐 · 证据引用</span><small>每次报告观察值</small></div>
        </div>
      </article>

      <article className={showcaseClasses("evaluator-ablation-arm", "is-withheld")} aria-labelledby="evaluator-withheld-title">
        <header><span aria-hidden="true">—</span><h3 id="evaluator-withheld-title">评估证据被实验屏蔽</h3></header>
        <div className={showcaseClasses("evaluator-ablation-stats")}>
          <div><strong>3/3</strong><span>无证据契约通过</span><small>不是普通 Harness 总分</small></div>
          <div><strong>0</strong><span>指标值返回</span><small>20 人曾请求评估</small></div>
          <div><strong>未评估</strong><span>能力覆盖</span><small>没有把缺失当作 0</small></div>
          <div><strong>0 · 0</strong><span>推荐 · 证据引用</span><small>报告明确标记实验屏蔽</small></div>
        </div>
        <p className={showcaseClasses("evaluator-ablation-harness-note")}><b>普通 Harness：29/31</b>　每次有两项能力覆盖检查因证据被屏蔽而未通过；控制契约另行 3/3 通过。</p>
      </article>
    </div>

    <div className={showcaseClasses("evaluator-ablation-pair-note")}>
      <span aria-hidden="true">＝</span>
      <p><strong>三对的下游 Planner / 工具轨迹相同。</strong> 差异出现在评估器证据与报告：开启臂引用了观测指标，屏蔽臂保留未知并放弃推荐。</p>
    </div>

    <details className={showcaseClasses("evaluator-ablation-method")}>
      <summary>模型、数据快照与实验边界</summary>
      <div>
        <p>巴萨进攻一对一前锋场景；本机 Qwen 3.5 9B；Wyscout 2017/18 curated 快照，SHA-256：<code>6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f</code>。三组运行交错执行；Planner、候选发现、方法检索、球员报告检索、Reviewer、模型和预算保持相同。</p>
        <p>这是一个冻结场景的三组配对机制检查。报告中的候选是模型输出，不是经过验证的球探判断；没有独立球探标签，因此不计算排序质量，也不据此推断普遍可靠性。</p>
      </div>
    </details>
  </section>;
}
