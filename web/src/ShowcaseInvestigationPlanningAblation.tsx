import { showcaseClasses } from "./showcase-classes";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const cases = [
  {
    number: "01",
    label: "CLEAR REQUEST · NO CLARIFICATION",
    title: "巴萨 U23 中场",
    checks: "31/31",
    runs: "3/3",
    evaluated: "20",
    tools: "6",
    clarifications: "0",
    evidence: "推进 20/20 有数据；压迫数据缺失。",
    recommendations: ["3", "1"],
    plannerDispatchAttempts: ["3", "1"],
    plannerTokensMean: ["8,625 / 602 / 9,227", "706 / 292 / 998"],
  },
  {
    number: "02",
    label: "TWO CLARIFICATIONS · SAME CASE RESUMED",
    title: "拜仁中锋替代者",
    checks: "29/29",
    runs: "3/3",
    evaluated: "19",
    tools: "8",
    clarifications: "2",
    evidence: "进球产出、创造机会 19/19 有数据；射门终结、进攻接应数据缺失。",
    recommendations: ["3", "1"],
    plannerDispatchAttempts: ["5", "3"],
    plannerTokensMean: ["13,011 / 515 / 13,526", "5,095 / 470 / 5,565"],
  },
] as const;

const arms = ["自适应 Planner", "固定单页基线"] as const;

export function ShowcaseInvestigationPlanningAblation() {
  return <section className={showcaseClasses("showcase-planning-ablation")} aria-labelledby="planning-ablation-title">
    <header className={showcaseClasses("planning-ablation-heading")}>
      <div>
        <p className={showcaseClasses("eyebrow")}>INVESTIGATION PLANNING · FULL-GRAPH ABLATION · 2026-10-13</p>
        <h2 id="planning-ablation-title">两组冻结场景中，自适应臂的 Planner tokens 均更高。</h2>
        <p>12 次整图运行的 Harness 检查全部通过；候选评估和报告推荐人数分别展示，不代表排序质量。</p>
      </div>
      <aside className={showcaseClasses("planning-ablation-proof")} aria-label="整图 Harness 验收结果">
        <span>FULL GRAPH RUNS</span>
        <strong>12<span> / 12</span></strong>
        <small>每个运行都通过对应 Harness 检查</small>
        <small>两个场景 · 各 3 组配对</small>
      </aside>
    </header>

    <div className={showcaseClasses("planning-ablation-cases")}>
      {cases.map((scenario) => <article className={showcaseClasses("planning-ablation-case")} key={scenario.number}>
        <header className={showcaseClasses("planning-case-heading")}>
          <span className={showcaseClasses("planning-case-number")}>{scenario.number}</span>
          <div>
            <p>{scenario.label}</p>
            <h3>{scenario.title}</h3>
          </div>
          <span className={showcaseClasses("planning-case-repeat")}>3 ×</span>
        </header>

        <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-[38rem]">
            <TableHeader><TableRow>
              <TableHead scope="col">观察项</TableHead>
              {arms.map((arm) => <TableHead scope="col" key={arm}>{arm}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              <TableRow><TableHead scope="row">Harness 检查</TableHead><TableCell>{scenario.runs} · {scenario.checks}</TableCell><TableCell>{scenario.runs} · {scenario.checks}</TableCell></TableRow>
              <TableRow><TableHead scope="row">模型 Planner 调度尝试</TableHead><TableCell>{scenario.plannerDispatchAttempts[0]} 次 / 平均</TableCell><TableCell>{scenario.plannerDispatchAttempts[1]} 次 / 平均</TableCell></TableRow>
              <TableRow><TableHead scope="row">Planner tokens / 整图均值</TableHead><TableCell>{scenario.plannerTokensMean[0]}</TableCell><TableCell>{scenario.plannerTokensMean[1]}</TableCell></TableRow>
              <TableRow><TableHead scope="row">工具调用</TableHead><TableCell>{scenario.tools} 次 / 平均</TableCell><TableCell>{scenario.tools} 次 / 平均</TableCell></TableRow>
              <TableRow><TableHead scope="row">已评估候选</TableHead><TableCell>{scenario.evaluated} 人 / 次</TableCell><TableCell>{scenario.evaluated} 人 / 次</TableCell></TableRow>
              <TableRow className="bg-secondary/40"><TableHead scope="row">报告推荐</TableHead><TableCell>{scenario.recommendations[0]} 人 / 次</TableCell><TableCell>{scenario.recommendations[1]} 人 / 次</TableCell></TableRow>
              <TableRow><TableHead scope="row">已回答追问</TableHead><TableCell>{scenario.clarifications} 次 / 案</TableCell><TableCell>{scenario.clarifications} 次 / 案</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
        <p className={showcaseClasses("planning-case-token-note")}>tokens 顺序：输入 / 输出 / 合计；每格是该策略 3 次整图运行的均值。</p>

        <p className={showcaseClasses("planning-case-evidence")}><span aria-hidden="true">↗</span><span><b>证据覆盖</b>{scenario.evidence}</span></p>
      </article>)}
    </div>

    <details className={showcaseClasses("planning-ablation-method")}>
      <summary>展开实验方法、模型和解释边界</summary>
      <div>
        <p><b>固定基线：</b>用同一条通用方法查询和一页候选请求；图在用户确认具体位置或同意扩展后仍可强制精确范围重查。两个臂共用候选批量评估、球员报告检索、追问与同案恢复、Reviewer 和最终报告模型，配对间交错运行顺序。</p>
        <p><b>运行环境：</b>Qwen 3.5 9B；TactiScout 自建 Wyscout 2017/18 curated 快照；SHA-256 `6f9c45c889d5ae553d1b395d87dd3ad6d1bac8dcf21c3cdadbcb627d14e8be4f`。</p>
        <p><b>实测用量：</b>2026-10-13 在候选意图与当前轮新鲜度守卫生效后，使用真实本机 Qwen/Ollama 对两个场景各重跑三组配对；36/36 次实际 Planner 请求均返回完整的输入、输出和总 token 数。表中显示每臂三次整图运行的均值。</p>
        <p><b>澄清后搜索：</b>拜仁样例先读取一页宽位置候选，再按用户确认的中锋位置重新查询；零匹配后，只有获得扩大范围的同意才开始新的 ATT 第 0 页搜索。评测将它视为新查询轮，同时要求同一分页序列严格沿用来源返回的下一页游标。</p>
        <p><b>解释边界：</b>这是两个冻结案例上的探索性机制检查。Planner 调度尝试包含报告生成、不含固定规则动作，不能替代实际调用账本。不同策略的输入上下文和生成内容不同，token 数不是金额成本，也不是 token 匹配比较。Harness 从 LangGraph 案件的 <code>conversation.turn()</code> 开始，只报告图内 Planner 用量，不代表完整浏览器交互或整款应用的模型用量。报告推荐条数不代表准确性；没有真人球探排序标签，也不比较 LangGraph 与其他框架。</p>
      </div>
    </details>
  </section>;
}
