import { z } from "zod/v4";
import { PositionSchema } from "./position-contracts.js";

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

/** User requirements only. Identity and observed player facts have separate owners. */
export const RecruitmentBriefSchema = z.object({
  task: z.enum(["reinforcement", "similarity", "replacement"]).describe("没有提到具体参考人物就是 reinforcement；指定某人这种风格是 similarity；填补某人岗位才是 replacement。"),
  targetTeam: groundedText.nullable(),
  referencePlayer: groundedText.nullable().describe("仅具体人名、外号或可核查的个人称呼；没有提到具体人物则为 null。能推进的中前卫、新的后卫等位置职责描述绝不是人名。"),
  referenceClues: z.array(RecruitmentBriefReferenceClueSchema).max(4).optional()
    .describe("仅用户明确用于识别参考人物的线索及连续原文；招募目标球队不是参考球员球队。例如为拜仁找罗德里替代者，不能把拜仁当罗德里的球队。不确定留空。"),
  referenceRecheck: RecruitmentBriefReferenceRecheckSchema.nullable().optional().describe("仅本轮明确拒绝当前身份、说都不是或要求重新核实参考人物时填写原话；明确不是这些人时 reject=true，单纯重试不拒绝人选；其他情况必须为 null。不继承上一轮。"),
  selectedCandidateId: z.string().min(1).max(300).nullable().default(null).describe("指代上一份可见候选时填其 playerId；referencePlayer.value 使用候选姓名，quote 则引用用户本轮的指代原话。"),
  positions: z.array(PositionSchema).max(12).describe("用户明确提及的位置代码，例如中前卫 CM、中卫 CB、后卫 DEF。禁止按模型记忆猜参考人物的位置。"),
  allowsAnyPosition: z.boolean().default(false),
  filters: z.object({
    maxAge: z.number().int().min(15).max(45).nullable(),
    minimumMinutes: z.number().int().min(0).max(5000),
    competition: z.string().max(100).nullable(),
    excludedCompetitions: z.array(z.string().min(1).max(100)).max(10).default([]),
    season: z.string().max(20).nullable(),
  }),
  priorities: z.array(groundedText).max(12),
  constraints: z.array(z.object({
    kind: z.enum(["age", "budget", "competition", "season", "minutes", "other"]),
    requirement: groundedText,
    strength: z.enum(["required", "preferred"]),
  })).max(12).describe("每个生效的 filter 都必须有同 kind、strength=required、requirement.basis=explicit 的条目，quote 引用用户原文。没有条件才为空数组；不能只填 filter 而漏掉依据。"),
  unresolved: z.array(z.object({
    topic: z.enum(["identity", "position", "preference"]),
    question: z.string().min(1).max(300),
    impact: z.string().min(1).max(300),
  })).max(3),
});

export type RecruitmentBrief = z.infer<typeof RecruitmentBriefSchema>;
