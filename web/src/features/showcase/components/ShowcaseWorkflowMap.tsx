import { showcaseClasses } from "../showcase-classes";

export function ShowcaseWorkflowMap() {
  return <section className={showcaseClasses("showcase-workflow")} aria-labelledby="showcase-workflow-title">
    <header className={showcaseClasses("showcase-workflow-heading")}>
      <p className={showcaseClasses("showcase-workflow-eyebrow")}>WHY LANGGRAPH · CASE CONTROL FLOW</p>
      <h2 id="showcase-workflow-title">引援调查不是一轮工具调用，而是同一案件里的状态循环。</h2>
      <p>需求会在调查中补充，证据不足时需要回查，结论还要经过复核。图负责保存案件进展并控制这些分支。</p>
    </header>

    <div className={showcaseClasses("showcase-workflow-main")} aria-label="LangGraph 主调查循环">
      <article className={showcaseClasses("showcase-workflow-node", "is-state")}>
        <span>SHARED CASE STATE</span>
        <h3>案件状态</h3>
        <p>需求、用户答复、已发现候选与证据</p>
      </article>
      <span className={showcaseClasses("showcase-workflow-arrow")} aria-hidden="true">→</span>
      <article className={showcaseClasses("showcase-workflow-node", "is-planner")}>
        <span>PLANNER + POLICY</span>
        <h3>规划下一步</h3>
        <p>Planner 提出动作；图策略检查边界并路由</p>
      </article>
      <span className={showcaseClasses("showcase-workflow-arrow")} aria-hidden="true">→</span>
      <article className={showcaseClasses("showcase-workflow-node", "is-tools")}>
        <span>TYPED TOOLS</span>
        <h3>研究工具</h3>
        <p>方法检索、候选搜索、表现评估与球员报告检索；结果回到 Planner</p>
      </article>
    </div>

    <div className={showcaseClasses("showcase-workflow-return")} aria-hidden="true"><span>↶</span><i>工具返回后继续规划</i></div>

    <div className={showcaseClasses("showcase-workflow-branches")} aria-label="Planner 的追问与结束分支">
      <article className={showcaseClasses("showcase-workflow-branch", "is-interrupt")}>
        <span className={showcaseClasses("showcase-workflow-branch-label")}>PLANNER 选择 ask_user</span>
        <h3>暂停等待答复</h3>
        <p><code>interrupt</code> 暂停；LangGraph checkpointer 保存同案状态，答复后继续调查。</p>
      </article>
      <article className={showcaseClasses("showcase-workflow-branch", "is-review")}>
        <span className={showcaseClasses("showcase-workflow-branch-label")}>PLANNER 选择 finish</span>
        <h3>Reviewer 核对证据</h3>
        <p>Reviewer 是报告门禁，不是第二个模型规划器；检查能力证据与候选引用是否对齐。</p>
        <div className={showcaseClasses("showcase-workflow-review-outcomes")}>
          <span><b>需要补证</b> → Planner</span>
          <span><b>通过</b> → 可选补充 → 报告</span>
        </div>
      </article>
    </div>

    <p className={showcaseClasses("showcase-workflow-footnote")}>模型提出调查动作；图策略负责可走的分支、预算与同案恢复，确定性 Reviewer 负责证据约束。这里展示的是当前工作流，不是推荐质量证明。</p>
  </section>;
}
