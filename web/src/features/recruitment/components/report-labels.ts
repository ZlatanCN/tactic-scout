import type { PlayerPosition } from "../../../../../src/domain/position-contracts.js";
import type { RecruitmentReport } from "../../../../../src/domain/reports.js";

export const positionLabels: Record<PlayerPosition, string> = {
  GK: "门将", DEF: "后卫（细分位置不限）", CB: "中后卫", FB: "边后卫", LB: "左后卫", RB: "右后卫", LWB: "左翼卫", RWB: "右翼卫",
  MID: "中场（细分位置不限）", DM: "后腰", CM: "中前卫", AM: "前腰", ATT: "前锋（细分位置不限）",
  WG: "边锋", LW: "左边锋", RW: "右边锋", ST: "中锋", UNKNOWN: "位置未知",
};

export function describePositionEvidenceLabel(player: RecruitmentReport["recommendations"][number]["player"]): string | null {
  const evidence = player.positionEvidence;
  if (!evidence) return null;
  if (evidence.provider !== "understat") {
    if (evidence.status === "direct") {
      const minutes = evidence.sampleMinutes === null ? "分钟未知" : `${evidence.sampleMinutes.toLocaleString()} 分钟`;
      return `位置观测：${evidence.sourceCodes.join(" / ") || positionLabels[evidence.targetPosition]} · ${minutes}`;
    }
    if (evidence.status === "broad_only") return `来源位置较宽：${evidence.sourceCodes.join(" / ") || positionLabels[player.position]}`;
    return evidence.status === "pending" ? "细分位置尚未核实" : "来源未返回可核实的位置明细";
  }
  if (evidence.status === "direct" || evidence.status === "compatible") {
    const prefix = evidence.status === "direct" ? "当前赛季位置" : "相邻位置记录";
    const codes = evidence.sourceCodes.length ? evidence.sourceCodes.join(" / ") : "代码未知";
    const minutes = evidence.sampleMinutes === null ? "分钟未知" : `${evidence.sampleMinutes.toLocaleString()} 分钟`;
    const scope = evidence.sourceScope === "season_position_aggregate" ? " · 赛季位置汇总，赛事未拆分" : "";
    return `${prefix}：${codes} · ${minutes}${scope}`;
  }
  if (evidence.status === "pending") return "Understat 当前赛季位置尚未核实";
  if (evidence.status === "not_observed") return "当前赛季未观察到对应位置标签";
  return "Understat 未返回可核实的位置明细";
}
