import { normalizeSearchText } from "../../domain/text-matching.js";
import type { RecruitmentBrief } from "../brief.js";
import type { RecruitmentReport } from "../../domain/reports.js";
import type { CapabilityMetricKey } from "../../domain/capabilities.js";

export type ReportFollowupContext = {
  recommendations: Array<{ playerId: string; evidenceKeys: CapabilityMetricKey[] }>;
};

function explicitlyPreservesRecruitmentScope(message: string): boolean {
  return /(?:保持|沿用|保留)(?:最初|原始|当前|原有|目前|这些|原来)?(?:完整)?(?:需求|范围|条件|筛选)|(?:不增不减|不改(?:变)?(?:位置|筛选|范围|条件)?|不改变(?:需求|范围|条件|筛选)|不增加(?:条件|筛选))/u.test(message);
}

function asksAboutTheCurrentReport(message: string): boolean {
  return /(?:说明|解释|展示|列出|总结|概括|比较|对比|核对|检查|分析|为什么|如何|哪些|依据|证据|指标|数据|样本|理由|风险|缺口|排序|报告|候选)/u.test(message);
}

function asksToChangeTheShortlist(message: string): boolean {
  return /(?:重新|再次|再).{0,8}(?:排序|排名|推荐|筛选|调查|考察)|(?:重排|换一批|改(?:一下|变)?(?:排序|排名|名单|候选|推荐)|调整(?:排序|排名|名单|候选|推荐)|(?:按|依据).{1,12}排序)|(?:增加|补充|剔除|删除|移除|减少|替换).{0,8}(?:候选|球员|名单)|(?:多|更多|另外|其他|其它).{0,10}(?:找|推荐|提供|补充|增加|列出).{0,10}(?:候选|球员|名单|人选)|(?:找|推荐|提供|列出).{0,10}(?:更多|其他|其它|不同|新的).{0,10}(?:候选|球员|名单|人选)|(?:换掉|另找|再找).{0,8}(?:候选|球员|名单)?/u.test(message);
}

function mentionsAnAdditionalRecruitmentConstraint(message: string): boolean {
  return /(?:预算|国籍|非欧|合同|伤病|身价|转会费|薪资|工资)|(?:年龄|年纪).{0,10}(?:\d|不限|不限制|上限|下限|改|调)|(?:排除|剔除|新增|追加|撤销|取消|放宽|收紧|改为|改成|换成|调整到|扩大到|缩小到).{0,10}(?:位置|联赛|赛季|年龄|预算|国籍|非欧|合同|伤病|分钟|赛事)/u.test(message);
}

export function createReportFollowupContext(input: {
  message: string;
  report: RecruitmentReport | null;
  brief: RecruitmentBrief | null;
  targetTeam: string | null;
  searchScopeChanged: boolean;
  pendingQuestion: boolean;
  structuredAnswer: boolean;
}): ReportFollowupContext | null {
  const { message, report, brief } = input;
  if (!report || !brief || brief.unresolved.length > 0 || input.searchScopeChanged
    || input.pendingQuestion || input.structuredAnswer) return null;
  if (normalizeSearchText(input.targetTeam ?? "") !== normalizeSearchText(brief.targetTeam?.value ?? "")) return null;
  if (!explicitlyPreservesRecruitmentScope(message)
    || !asksAboutTheCurrentReport(message)
    || asksToChangeTheShortlist(message)
    || mentionsAnAdditionalRecruitmentConstraint(message)) return null;

  return {
    recommendations: report.recommendations.map(({ player, focusEvidenceKeys }) => ({
      playerId: player.playerId,
      evidenceKeys: [...focusEvidenceKeys],
    })),
  };
}
