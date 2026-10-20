import { showcaseClasses } from "../showcase-classes";
import { Badge } from "@/shared/ui/badge";
import { ProductHeader } from "@/shared/ui/product-header";
import { ShowcaseLatencySummary } from "./ShowcaseLatencySummary";
import { ShowcaseReviewerAblation } from "./ShowcaseReviewerAblation";
import { ShowcaseClarificationInteraction } from "./ShowcaseClarificationInteraction";
import { ShowcaseAskPolicyAblation } from "./ShowcaseAskPolicyAblation";
import { ShowcaseMethodologyRagAblation } from "./ShowcaseMethodologyRagAblation";
import { ShowcaseInvestigationPlanningAblation } from "./ShowcaseInvestigationPlanningAblation";
import { ShowcaseEvidenceEvaluatorAblation } from "./ShowcaseEvidenceEvaluatorAblation";
import { ShowcaseExecutiveStory, ShowcaseLayoutPrototype, type ShowcasePrototypeVariant } from "./ShowcaseLayoutPrototype";

const recordedRun = {
  date: "2026-10-09",
  model: "Qwen 3.5 9B · Ollama",
  elapsed: "2 分 52 秒",
  checkCount: 29,
  toolCallCount: 10,
  clarificationCount: 2,
  evaluatedCount: 30,
  matchingCount: 601,
  readCount: 40,
  methodologyChunks: 2,
  playerReportChunks: 0,
  leadCount: 1,
} as const;

const journey = [
  {
    number: "01",
    actor: "方法检索 → 候选查询",
    title: "先读方法，再找候选",
    description: "Planner 先调用方法资料检索，再查询历史候选池。方法检索返回 2 个片段；候选查询命中 601 条记录。",
    detail: "首次只读取有限页面，没有把 601 条匹配记录说成已全部评估。",
  },
  {
    number: "02",
    actor: "需求不明 → 暂停补充",
    title: "关键职责不明确，暂停询问",
    description: "工作流记录到第一次 ask_user。补充回答后，LangGraph 从同一案件恢复，继续执行候选查询。",
    detail: "录制摘要不含对话原文，因此这里不还原具体问句。",
  },
  {
    number: "03",
    actor: "无匹配 → 确认扩围",
    title: "中锋范围无匹配，再确认是否扩围",
    description: "指定范围的候选查询返回 0 条。图没有自动改位置凑结果，而是再次等待用户确认；收到补充后才继续搜索。",
    detail: "两次等待都来自本次运行中观察到的 ask_user 状态。",
  },
  {
    number: "04",
    actor: "候选评估 → 报告检索",
    title: "按确认后的范围分批调查",
    description: "后续查询读取了 40 条记录，评估了 30 名候选；表现评估与球员报告检索交替执行。",
    detail: "工具调用共 10 次：方法检索 1 次、候选查询 3 次、表现评估 3 次、球员报告检索 3 次。",
  },
  {
    number: "05",
    actor: "证据复核 → 报告生成",
    title: "证据通过约束后形成考察线索",
    description: "Reviewer 完成检查并生成报告。报告保留了能力缺口，没有把相邻指标包装成射门终结或进攻接应的直接证据。",
    detail: "安全 Harness 的 29 项行为检查全部通过；这不等于候选排序已经被球探标签验证。",
  },
] as const;

const metrics = [
  { value: "02", label: "次用户澄清", note: "同一案件恢复" },
  { value: "10", label: "次工具调用", note: "来自安全运行轨迹" },
  { value: "30", label: "名候选被评估", note: "不是完整匹配池" },
  { value: "29/29", label: "Harness 行为检查", note: "单次运行" },
] as const;

const studies = [
  { key: "evidence-evaluator", title: "候选能力证据评估器", takeaway: "三组配对中，证据开启时每次有 3 条线索 / 6 条引用；屏蔽后均弃权。", limitation: "一个冻结场景；验证证据传递，不验证推荐质量。", content: <ShowcaseEvidenceEvaluatorAblation /> },
  { key: "planning", title: "自适应调查规划", takeaway: "两组场景中，自适应臂的平均 Planner tokens 均更高。", limitation: "每场景三组配对；token 不代表金额成本或排序质量。", content: <ShowcaseInvestigationPlanningAblation /> },
  { key: "clarification", title: "追问、暂停与同案恢复", takeaway: "答复可用时继续；答复缺席时在必要追问处暂停。", limitation: "两个冻结场景，各三组配对；不是通用追问策略评测。", content: <ShowcaseClarificationInteraction /> },
  { key: "ask-policy", title: "禁用追问策略的对照", takeaway: "关键职责缺失时安全暂停，清晰需求仍正常完成。", limitation: "切换的是整图追问边界；Planner 禁问本身不能替代该对照。", content: <ShowcaseAskPolicyAblation /> },
  { key: "reviewer", title: "Reviewer 证据复核", takeaway: "缺证据时修复引用；证据完整时维持原报告。", limitation: "两个场景，各三组配对；没有真人球探标签。", content: <ShowcaseReviewerAblation /> },
  { key: "rag", title: "方法 RAG 的检索与整图证据", takeaway: "跨语言留出证据覆盖从 1/3 升到 3/3；早期整图消融把检索证据传入报告。", limitation: "仅 12 个作者标注意图；译文未独立双语审校，也不评估推荐质量。", content: <ShowcaseMethodologyRagAblation /> },
  { key: "latency", title: "Planner 与工具的延迟", takeaway: "三个运行中，长等待集中在 Planner 决策。", limitation: "3 次端到端样本；Planner 时间不是纯模型推理时间，也不能相加推导总时长。", content: <ShowcaseLatencySummary /> },
] as const;

export function RecordedRunShowcase() {
  const requestedVariant = new URLSearchParams(window.location.search).get("variant");
  const prototypeVariant = import.meta.env.DEV && (requestedVariant === "a" || requestedVariant === "b" || requestedVariant === "c") ? requestedVariant satisfies ShowcasePrototypeVariant : null;
  return <div className={showcaseClasses("showcase-shell")}>
    <ProductHeader page="showcase" rightContent={<Badge variant="secondary">录制运行 · 历史样本</Badge>} />

    <main id="main-content" className={showcaseClasses("showcase-main")}>
      {import.meta.env.DEV && prototypeVariant ? <ShowcaseLayoutPrototype initialVariant={prototypeVariant} run={recordedRun} journey={journey} metrics={metrics} studies={studies} /> : <ShowcaseExecutiveStory run={recordedRun} journey={journey} metrics={metrics} studies={studies} />}

    </main>

    <footer className={showcaseClasses("site-footer", "showcase-footer")}><span>TactiScout <b>·</b> Football scouting research prototype</span><span>录制运行 · {recordedRun.date}</span></footer>
  </div>;
}
