import { z } from "zod/v4";

export const RecruitmentBriefReferenceClueSchema = z.object({
  kind: z.enum(["team", "nationality", "position", "era"]),
  value: z.string().min(1).max(100),
  quote: z.string().min(1).max(300),
});

export const RecruitmentBriefReferenceRecheckSchema = z.object({
  quote: z.string().min(1).max(300),
  reject: z.boolean().optional(),
});

const groundedText = z.object({
  value: z.string().trim().min(1).max(160),
  basis: z.enum(["explicit", "inferred"]),
  quote: z.string().max(300),
});

export const RecruitmentCriterionFieldSchema = z.enum([
  "position", "age", "minimumMinutes", "competition", "season", "budget",
  "heightCm", "potentialAbility", "currentAbility", "fmAttribute",
  "nationality", "club", "capability", "other",
]);

export const RecruitmentCriterionOperatorSchema = z.enum([
  "lt", "lte", "gt", "gte", "eq", "in", "not_in", "any", "prefer_high", "prefer_low", "match",
]);

export const RecruitmentCriterionSchema = z.object({
  field: RecruitmentCriterionFieldSchema,
  operator: RecruitmentCriterionOperatorSchema,
  value: z.union([z.number(), z.string(), z.array(z.string())]).nullable(),
  unit: z.string().max(40).nullable().optional(),
  attributeKey: z.string().max(80).nullable().optional(),
  strength: z.enum(["required", "preferred", "excluded"]),
  basis: z.enum(["explicit", "inferred"]),
  quote: z.string().max(300).describe("Shortest continuous verbatim user span that states this specific criterion, including its threshold and unit when present."),
}).describe("One atomic user requirement. Preserve its field, operator, value/unit, hard/soft/exclusion intent, and source quote. Do not merge separate conditions into other text.");

export const FmSearchCriterionSchema = RecruitmentCriterionSchema.extend({
  field: z.enum(["heightCm", "potentialAbility", "currentAbility", "fmAttribute"]),
  operator: z.enum(["lt", "lte", "gt", "gte", "prefer_high", "prefer_low"]),
  value: z.number().nullable(),
  unit: z.string().max(40).nullable().optional(),
  attributeKey: z.string().max(80).nullable().optional(),
});

/** Canonical user request. Search filters and ranking actions are compiled from criteria. */
export const RecruitmentBriefSchema = z.object({
  task: z.enum(["reinforcement", "similarity", "replacement"]).describe("没有提到具体参考人物就是 reinforcement；指定某人这种风格是 similarity；填补某人岗位才是 replacement。"),
  targetTeam: groundedText.nullable(),
  referencePlayer: groundedText.nullable().describe("仅具体人名、外号或可核查的个人称呼；没有提到具体人物则为 null。能推进的中前卫、新的后卫等位置职责描述绝不是人名。"),
  referenceClues: z.array(RecruitmentBriefReferenceClueSchema).max(4).optional()
    .describe("仅用户明确用于识别参考人物的线索及连续原文；招募目标球队不是参考球员球队。例如为拜仁找罗德里替代者，不能把拜仁当罗德里的球队。不确定留空。"),
  referenceRecheck: RecruitmentBriefReferenceRecheckSchema.nullable().optional().describe("仅本轮明确拒绝当前身份、说都不是或要求重新核实参考人物时填写原话；明确不是这些人时 reject=true，单纯重试不拒绝人选；其他情况必须为 null。不继承上一轮。"),
  selectedCandidateId: z.string().min(1).max(300).nullable().default(null).describe("指代上一份可见候选时填其 playerId；referencePlayer.value 使用候选姓名，quote 则引用用户本轮的指代原话。"),
  criteria: z.array(RecruitmentCriterionSchema).max(32)
    .describe("按用户表达拆成独立条件。heightCm/potentialAbility/currentAbility/fmAttribute 是可使用 FM 画像的字段；‘最好潜力高’应为 potentialAbility + prefer_high + preferred，不可变成硬门槛；‘至少190cm’应为 heightCm + gte + 190 + cm + required。位置也必须作为带原文依据的 criterion，不另猜一个 positions 数组。"),
  unresolved: z.array(z.object({
    topic: z.enum(["identity", "position", "preference"]),
    question: z.string().min(1).max(300),
    impact: z.string().min(1).max(300),
  })).max(3),
});

export type RecruitmentBrief = z.infer<typeof RecruitmentBriefSchema>;
export type RecruitmentCriterion = z.infer<typeof RecruitmentCriterionSchema>;
export type FmSearchCriterion = z.infer<typeof FmSearchCriterionSchema>;
