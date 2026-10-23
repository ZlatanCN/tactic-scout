import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { EvidenceRefSchema } from "../domain/evidence.js";
import { RagV2QuestionPackSchema, type RagV2QuestionPack, validateRagV2QuestionPack } from "./rag-v2-evaluation.js";
import type { RagV2JudgeControlCase } from "./rag-v2-runner.js";

const ControlCaseSchema = z.object({
  controlId: z.string().min(1),
  expected: z.enum(["positive", "negative"]),
  controlType: z.enum(["grounded_answer", "unsupported_date", "unsupported_number", "wrong_citation", "omitted_citation"]),
  query: z.string().min(2),
  answer: z.string().min(1),
  abstained: z.boolean(),
  sourceArticleIds: z.array(z.string().min(1)).min(1),
  citedEvidence: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), ref: EvidenceRefSchema, sourceId: z.string().min(1), articleId: z.string().min(1) })).max(8),
  requiredFacts: z.array(z.string().min(1)).min(1),
  expectedDisposition: z.literal("answerable"),
}).superRefine((control, context) => {
  if (control.controlType === "grounded_answer" && (control.expected !== "positive"
    || control.citedEvidence.some(({ articleId }) => !control.sourceArticleIds.includes(articleId)))) {
    context.addIssue({ code: "custom", path: ["citedEvidence"], message: "正控制必须引用题目指定的来源文章。" });
  }
  if (control.controlType === "wrong_citation" && (control.expected !== "negative"
    || !control.citedEvidence.some(({ articleId }) => !control.sourceArticleIds.includes(articleId)))) {
    context.addIssue({ code: "custom", path: ["citedEvidence"], message: "错误引用负控制必须引用至少一篇范围外文章。" });
  }
  if (control.controlType === "omitted_citation" && (control.expected !== "negative" || control.citedEvidence.length !== 0)) {
    context.addIssue({ code: "custom", path: ["citedEvidence"], message: "漏引用负控制必须不含任何引用。" });
  }
});

export const RagV2JudgeControlsPackSchema = z.object({
  schemaVersion: z.literal("rag-v2-judge-controls-v5"),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/u),
  label: z.literal("deterministic_control_set"),
  construction: z.literal("deterministic-span-positive-and-unmentioned-claim-negative-v2"),
  controls: z.array(ControlCaseSchema).min(24),
}).superRefine((pack, context) => {
  const positives = pack.controls.filter(({ expected }) => expected === "positive").length;
  const negatives = pack.controls.filter(({ expected }) => expected === "negative").length;
  if (positives < 12) context.addIssue({ code: "custom", path: ["controls"], message: "至少需要 12 个正控制。" });
  if (negatives < 12) context.addIssue({ code: "custom", path: ["controls"], message: "至少需要 12 个负控制。" });
  const controlIds = new Set(pack.controls.map(({ controlId }) => controlId));
  if (controlIds.size !== pack.controls.length) context.addIssue({ code: "custom", path: ["controls"], message: "评审控制题 ID 不能重复。" });
  for (const [controlType, minimum] of [["grounded_answer", 12], ["wrong_citation", 3], ["omitted_citation", 3], ["unsupported_date", 3], ["unsupported_number", 3]] as const) {
    const count = pack.controls.filter((control) => control.controlType === controlType).length;
    if (count < minimum) context.addIssue({ code: "custom", path: ["controls"], message: controlType + " 控制题至少需要 " + minimum + " 道。" });
  }
});
export type RagV2JudgeControlsPack = z.infer<typeof RagV2JudgeControlsPackSchema>;

function evidenceId(reference: z.infer<typeof EvidenceRefSchema>): string {
  return createHash("sha256").update(JSON.stringify(reference)).digest("hex");
}

function verifiedCitations(
  question: RagV2QuestionPack["questions"][number],
  sourceTexts: ReadonlyMap<string, string>,
): Array<{ id: string; text: string; ref: z.infer<typeof EvidenceRefSchema>; sourceId: string; articleId: string }> | null {
  const spans = question.facts.flatMap((fact) => fact.supportPaths[0] ?? []);
  const unique = spans.filter((span, index, all) => all.findIndex((other) => (
    other.documentRevisionId === span.documentRevisionId && other.sectionId === span.sectionId
    && other.startOffset === span.startOffset && other.endOffset === span.endOffset && other.textHash === span.textHash
  )) === index);
  if (!unique.length || unique.length > 8) return null;
  const citations = unique.map((span) => {
    const section = sourceTexts.get(span.documentRevisionId + "\n" + span.sectionId);
    if (section === undefined || span.endOffset > section.length) return null;
    const text = section.slice(span.startOffset, span.endOffset);
    if (!text.trim() || createHash("sha256").update(text).digest("hex") !== span.textHash) return null;
    const { sourceId, articleId: _articleId, ...ref } = span;
    return { id: evidenceId(ref), text, ref, sourceId, articleId: span.articleId };
  });
  return citations.every((citation) => citation !== null)
    ? citations as Array<{ id: string; text: string; ref: z.infer<typeof EvidenceRefSchema>; sourceId: string; articleId: string }>
    : null;
}

export interface RagV2JudgeControlsBuildResult {
  ready: boolean;
  pack: RagV2JudgeControlsPack | null;
  reason: string | null;
}

export function buildRagV2JudgeControls(input: {
  packet: RagV2QuestionPack;
  sourceTexts: ReadonlyMap<string, string>;
}): RagV2JudgeControlsBuildResult {
  const packet = RagV2QuestionPackSchema.parse(input.packet);
  const developmentQuestions = packet.questions.filter((question) => question.split === "development" && question.expectedDisposition === "answerable");
  const positives: Array<z.infer<typeof ControlCaseSchema>> = [];
  const dateNegatives: Array<z.infer<typeof ControlCaseSchema>> = [];
  const numberNegatives: Array<z.infer<typeof ControlCaseSchema>> = [];
  const wrongCitationNegatives: Array<z.infer<typeof ControlCaseSchema>> = [];
  const omittedCitationNegatives: Array<z.infer<typeof ControlCaseSchema>> = [];
  const citationCache = new Map(developmentQuestions.map((question) => [question.id, verifiedCitations(question, input.sourceTexts)]));
  for (const question of developmentQuestions) {
    const citations = citationCache.get(question.id);
    if (!citations) continue;
    const requiredFacts = question.facts.map(({ statement }) => statement);
    const grounded = {
      query: question.query,
      answer: requiredFacts.join(" "),
      abstained: false,
      citedEvidence: citations,
      sourceArticleIds: question.sourceArticleIds,
      requiredFacts,
      expectedDisposition: "answerable" as const,
    };
    positives.push(ControlCaseSchema.parse({
      controlId: "positive-" + question.id,
      expected: "positive",
      controlType: "grounded_answer",
      ...grounded,
    }));

    const citedText = citations.map(({ text }) => text).join("\n");
    const unsupportedDateCandidates = ["2099-12-31", "2049-08-17", "1987-02-09"];
    const unsupportedDate = unsupportedDateCandidates.find((value) => !citedText.includes(value));
    const unsupportedNumberCandidates = ["987654321", "876543219", "765432198"];
    const unsupportedNumber = unsupportedNumberCandidates.find((value) => !citedText.includes(value));
    if (unsupportedDate) {
      dateNegatives.push(ControlCaseSchema.parse({
        controlId: "negative-date-" + question.id,
        expected: "negative",
        controlType: "unsupported_date",
        ...grounded,
        answer: grounded.answer + " The exact match date was " + unsupportedDate + ".",
      }));
    }
    if (unsupportedNumber) {
      numberNegatives.push(ControlCaseSchema.parse({
        controlId: "negative-number-" + question.id,
        expected: "negative",
        controlType: "unsupported_number",
        ...grounded,
        answer: grounded.answer + " The source also reports exactly " + unsupportedNumber + " events.",
      }));
    }
    omittedCitationNegatives.push(ControlCaseSchema.parse({
      controlId: "negative-omitted-citation-" + question.id,
      expected: "negative",
      controlType: "omitted_citation",
      ...grounded,
      citedEvidence: [],
    }));
    const wrongCitationQuestion = developmentQuestions.find((candidate) => {
      if (candidate.id === question.id) return false;
      const alternate = citationCache.get(candidate.id);
      if (!alternate?.length || alternate.every(({ articleId }) => question.sourceArticleIds.includes(articleId))) return false;
      const alternateText = alternate.map(({ text }) => text).join("\n");
      return requiredFacts.every((fact) => !alternateText.includes(fact));
    });
    const wrongCitations = wrongCitationQuestion ? citationCache.get(wrongCitationQuestion.id) : null;
    if (wrongCitations?.length) {
      wrongCitationNegatives.push(ControlCaseSchema.parse({
        controlId: "negative-wrong-citation-" + question.id,
        expected: "negative",
        controlType: "wrong_citation",
        ...grounded,
        citedEvidence: wrongCitations.slice(0, 2),
      }));
    }
  }
  const negatives = [
    ...wrongCitationNegatives.slice(0, 3),
    ...omittedCitationNegatives.slice(0, 3),
    ...dateNegatives.slice(0, 3),
    ...numberNegatives.slice(0, 3),
  ];
  if (positives.length < 12 || negatives.length < 12) {
    return { ready: false, pack: null, reason: "开发集未能为正确引用、错误引用、漏引用、错误年份和错误数字各构造足量且原文可核验的评审控制。" };
  }
  const packetSha256 = validateRagV2QuestionPack(packet).packSha256;
  const pack = RagV2JudgeControlsPackSchema.parse({
    schemaVersion: "rag-v2-judge-controls-v5",
    packetSha256,
    sourceSnapshotHash: packet.sourceSnapshotHash,
    label: "deterministic_control_set",
    construction: "deterministic-span-positive-and-unmentioned-claim-negative-v2",
    controls: [...positives.slice(0, 12), ...negatives],
  });
  return { ready: true, pack, reason: null };
}

export function judgeControlCasesFromPack(pack: RagV2JudgeControlsPack): RagV2JudgeControlCase[] {
  return RagV2JudgeControlsPackSchema.parse(pack).controls;
}
