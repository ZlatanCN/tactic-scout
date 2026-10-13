import type { ShortlistReviewGrade } from "./shortlist-review.js";

export const shortlistFitRubric = [
  {
    value: 0,
    label: "0",
    detail: "明确不符",
    anchor: "充分且直接的证据表明不满足冻结职责，或违反本次明确的硬条件；缺少或未覆盖的数据不能判 0。",
  },
  {
    value: 1,
    label: "1",
    detail: "较弱或部分吻合",
    anchor: "证据较弱，或只覆盖职责的一部分。",
  },
  {
    value: 2,
    label: "2",
    detail: "有合理证据支持",
    anchor: "来源证据合理支持候选具备本次点名的能力或职责，但支持尚未达到 3 分。",
  },
  {
    value: 3,
    label: "3",
    detail: "高度符合目标职责",
    anchor: "来源证据对本次点名能力或职责提供强而直接的支持。",
  },
  {
    value: "unknown",
    label: "未知",
    detail: "现有证据不足",
    anchor: "现有材料无法判断适配度，例如缺字段、样本不足、指标与能力不对应或信息含糊；它既不是 0 分，也不表示不适配。",
  },
] as const satisfies readonly {
  value: ShortlistReviewGrade;
  label: string;
  detail: string;
  anchor: string;
}[];
