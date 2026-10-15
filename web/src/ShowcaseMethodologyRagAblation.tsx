import { showcaseClasses } from "./showcase-classes";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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

const retrievalMetrics = [
  { label: "留出可回答证据覆盖", chinese: "1/3", english: "3/3" },
  { label: "PLOS 候选论文覆盖", chinese: "0/2", english: "2/2" },
  { label: "来源对召回率", chinese: "1/3", english: "3/3" },
  { label: "来源对精确率", chinese: "1.0", english: "1.0" },
] as const;

export function ShowcaseMethodologyRagAblation() {
  return <section className={showcaseClasses("showcase-rag-ablation")} aria-labelledby="showcase-rag-title">
    <header className={showcaseClasses("rag-ablation-heading")}>
      <div>
        <p className={showcaseClasses("eyebrow")}>METHODOLOGY RAG · CROSS-LINGUAL RETRIEVAL · 2026-10-13</p>
        <h2 id="showcase-rag-title">作者译写的英文问题，让留出证据覆盖从 1/3 提高到 3/3。</h2>
        <p>只切换查询语言；同一索引、multilingual E5 与原有检索门槛。翻译没有接入 Agent。</p>
      </div>
      <aside className={showcaseClasses("rag-ablation-proof")} aria-label="留出集可回答证据覆盖：中文原问 1/3，作者英文译问 3/3">
        <span>HELD-OUT EVIDENCE</span>
        <strong>1/3 <i>→</i> 3/3</strong>
        <small>中文原问 → 项目作者英文译问</small>
      </aside>
    </header>

    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border">
      <Table className="min-w-[32rem]">
        <TableCaption>中文原问与作者英文译问的留出集检索指标</TableCaption>
        <TableHeader><TableRow><TableHead scope="col">留出集指标</TableHead><TableHead scope="col">中文原问</TableHead><TableHead scope="col">作者英文译问</TableHead></TableRow></TableHeader>
        <TableBody>{retrievalMetrics.map((metric) => <TableRow key={metric.label}>
          <TableHead scope="row">{metric.label}</TableHead>
          <TableCell>{metric.chinese}</TableCell>
          <TableCell className={metric.chinese === metric.english ? "text-muted-foreground" : "font-semibold text-primary"}>{metric.english}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      </div>
      <p className={showcaseClasses("rag-crosslingual-safety")}>两臂都没有接受不支持的模糊来源；范围外误接收均为 0/2。阈值保持不变：cosine ≥ 0.812，片段词项覆盖 ≥ 0.5。</p>
    </div>

    <section className={showcaseClasses("rag-graph-ablation")} aria-labelledby="rag-graph-title">
      <header className={showcaseClasses("rag-graph-heading")}>
        <div>
          <p className={showcaseClasses("eyebrow")}>FULL-GRAPH ABLATION · 2026-10-10</p>
          <h3 id="rag-graph-title">方法证据进入了报告；这次实验没有观察到候选顺序变化。</h3>
          <p>同一张 LangGraph 做三组配对，只屏蔽方法语料，其余工具和 Reviewer 保持运行。</p>
        </div>
        <span className={showcaseClasses("rag-graph-pass")}>早期运行 <b>6/6</b> 通过</span>
      </header>

      <div className={showcaseClasses("rag-ablation-arms")}>
        {arms.map((arm) => <article className={showcaseClasses("rag-ablation-arm", arm.className === "available" ? "is-enabled" : "is-disabled")} key={arm.className}>
          <header><span aria-hidden="true">{arm.className === "available" ? "↗" : "—"}</span><h4>{arm.heading}</h4></header>
          <div className={showcaseClasses("rag-ablation-flow")}>
            <div><strong>{arm.retrieval}</strong><span>{arm.retrievalLabel}</span><small>检索结果</small></div>
            <i aria-hidden="true">→</i>
            <div><strong>{arm.report}</strong><span>{arm.reportLabel}</span><small>最终报告</small></div>
          </div>
          <p className={showcaseClasses("rag-ablation-check")}><b>{arm.result}</b><span>{arm.resultLabel}</span></p>
        </article>)}
      </div>

      <div className={showcaseClasses("rag-ablation-pair-note")}>
        <span aria-hidden="true">!</span>
        <p><strong>复跑暴露了场景检查波动。</strong>10 月 13 日两臂均为 27/29，并同时未通过候选位置与范围扩展检查；这次复跑不能支持 RAG 改变调查决策的结论。</p>
      </div>
    </section>

    <details className={showcaseClasses("rag-ablation-method")}>
      <summary>评测样本、实验设置与结论边界</summary>
      <div>
        <p>跨语言诊断使用 12 个全新意图家族，校准和留出各 6 个；每个中文问题配一条项目作者的英文译写，同族共享答案标签。两臂使用同一临时 PLOS 论文索引、multilingual E5、来源登记与检索策略，只改变 query 语言。评测后清除了当前索引中的 56 个临时片段。</p>
        <p>12 个 query family 是小样本，英文译写没有经过独立双语审校。结果只适用于这组作者标注问题；它没有验证线上翻译、不证明普遍 RAG 表现，也不验证球员推荐质量。</p>
        <p>整图消融使用本机 Qwen 3.5 9B、拜仁替代者场景和 Wyscout 2017/18 快照。10 月 10 日三组配对的非方法工具轨迹和候选顺序相同；10 月 13 日重跑两臂同样失败于两项场景检查，因此保留早期报告传递观察，但不宣称稳定决策效果。</p>
      </div>
    </details>
  </section>;
}
