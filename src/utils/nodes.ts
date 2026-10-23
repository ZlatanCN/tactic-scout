import type { LanguageModelLike } from "@langchain/core/language_models/base";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { interrupt, type GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";
import type { ReferenceResolutionState } from "./state.js";
import { AgentState } from "./state.js";
import type { ReferenceIdentityLookup } from "./tools.js";

const assistantPrompt = `你是一个足球资料助手。回答球员问题时先调用 search_player_records 工具，根据工具返回的来源记录作答。
Understat 比赛表现与 Football Manager 能力画像是不同来源、不同含义的数据。不要把同名记录当成已确认的同一球员。不要补猜缺失值、当前球队、合同、身价或转会可行性。说明来源、赛事和赛季；没有证据时明确说未知。`;

const referenceExtractionSchema = z.object({
  referenceMention: z
    .string()
    .nullable()
    .describe("用户原文中的参考球员称呼；没有则为 null。"),
  lookupName: z
    .string()
    .nullable()
    .describe(
      "如果用户使用中文音译或简称，给出一个仅用于本地搜索的可能全名；不能据此确认身份。",
    ),
});

const referenceExtractionPrompt = `判断本轮请求是否需要识别一个作为替代、接班、比较或相似对象的球员。
referenceMention 必须照抄用户实际写出的称呼，不能凭常识扩写。lookupName 只用于本地查找：如果用户用了中文音译或简称，可以填最可能的英文全名；不确定则填 null。lookupName 只是检索提示，不能当作身份确认。没有被引用的球员时两个字段都返回 null。`;

type ExtractedReference = {
  referenceMention: string | null;
  lookupName: string | null;
};
type ReferenceMentionExtractor = (
  message: string,
) => Promise<ExtractedReference>;

const createReferenceMentionExtractor = (
  model: BaseChatModel,
): ReferenceMentionExtractor => {
  const structuredModel = model.withStructuredOutput(referenceExtractionSchema);
  return async (message) => {
    if (!referenceIntentPattern.test(message)) {
      return { referenceMention: null, lookupName: null };
    }
    const result = await structuredModel.invoke([
      new SystemMessage(referenceExtractionPrompt),
      new HumanMessage(message),
    ]);
    return {
      referenceMention: result.referenceMention?.trim() || null,
      lookupName: result.lookupName?.trim() || null,
    };
  };
};

const createReferenceResolutionNode =
  (
    extractReference: ReferenceMentionExtractor,
    lookup: ReferenceIdentityLookup,
  ): GraphNode<typeof AgentState> =>
  async (state) => {
    const currentResolution =
      state.referenceResolution ?? createEmptyResolution("not_required", null);
    if (typeof state.referenceAnswer === "string") {
      return applyReferenceAnswer(
        currentResolution,
        state.referenceAnswer,
        lookup,
      );
    }

    const latestUserMessage = [...state.messages]
      .reverse()
      .find((message) => message instanceof HumanMessage);
    if (!latestUserMessage) return {};

    const messageId = latestUserMessage.id ?? null;
    if (messageId && messageId === currentResolution.processedMessageId)
      return {};

    const text =
      typeof latestUserMessage.content === "string"
        ? latestUserMessage.content
        : JSON.stringify(latestUserMessage.content);
    const extracted = await extractReference(text);
    const mention = extracted.referenceMention;

    if (!mention) {
      const resolution =
        currentResolution.status === "resolved"
          ? { ...currentResolution, processedMessageId: messageId }
          : createEmptyResolution("not_required", messageId);
      return { referenceResolution: resolution };
    }

    const lookupName = extracted.lookupName ?? mention;
    const result = await lookup(lookupName);
    const translatedOrExpanded =
      normalizeName(lookupName) !== normalizeName(mention);
    const resolution =
      translatedOrExpanded && result.status === "resolved"
        ? {
            ...result,
            status: "needs_confirmation" as const,
            mention,
            selectedCandidateId: null,
            canonicalIdentityId: null,
            selectedName: null,
            clarificationMessage: `你写的是“${mention}”。本地资料中找到“${result.selectedName}”，请确认是否指这位球员。`,
          }
        : { ...result, mention };

    return {
      referenceResolution: {
        ...resolution,
        processedMessageId: messageId,
        attempts: 0,
      },
    };
  };

const applyReferenceAnswer = async (
  current: ReferenceResolutionState,
  answer: string,
  lookup: ReferenceIdentityLookup,
) => {
  const selected = findSelectedCandidate(answer, current);
  if (selected) {
    return {
      referenceAnswer: null,
      referenceResolution: {
        ...current,
        status: "resolved" as const,
        selectedCandidateId: selected.candidateId,
        canonicalIdentityId: selected.canonicalIdentityId,
        selectedName: selected.name,
        clarificationMessage: null,
      },
    };
  }

  if (current.attempts >= 2) {
    return {
      referenceAnswer: null,
      referenceResolution: {
        ...current,
        status: "clarification_exhausted" as const,
        clarificationMessage:
          "我仍无法确认你指的球员。请用完整姓名重新提出请求。",
      },
    };
  }

  const cleanedAnswer = cleanReferenceAnswer(answer);
  const isCandidateChoice = /^\d+$/.test(cleanedAnswer);
  const result =
    cleanedAnswer && !isCandidateChoice ? await lookup(cleanedAnswer) : null;
  return {
    referenceAnswer: null,
    referenceResolution: result
      ? {
          ...result,
          processedMessageId: current.processedMessageId,
          attempts: current.attempts + 1,
          clarificationMessage:
            result.status === "resolved"
              ? null
              : (result.clarificationMessage ??
                "请回复候选编号或完整球员姓名。"),
        }
      : {
          ...current,
          status: "needs_confirmation" as const,
          attempts: current.attempts + 1,
          clarificationMessage:
            "我没能对应这条回答，请回复候选编号或完整球员姓名。",
        },
  };
};

const createReferenceClarificationNode =
  (): GraphNode<typeof AgentState> => async (state) => {
    const resolution = state.referenceResolution;
    const candidates = resolution.candidates.map((candidate, index) => ({
      number: index + 1,
      name: candidate.name,
      sources: [...new Set(candidate.records.map((record) => record.provider))],
      identityLinked: candidate.identityVerified,
      records: candidate.records.map((record) => ({
        source: record.provider,
        team: record.team,
        competition: record.competition,
        season: record.season,
      })),
    }));

    const question =
      resolution.clarificationMessage ??
      (candidates.length
        ? `你说的“${resolution.mention}”可能对应多个身份。请回复候选编号或完整姓名。`
        : `我无法确认“${resolution.mention}”指哪位球员。请提供完整姓名或球队线索。`);
    const resumeValue = interrupt({
      kind: "reference_identity_confirmation",
      mention: resolution.mention,
      question,
      candidates,
    });
    return { referenceAnswer: resumeValueToText(resumeValue) };
  };

const createUnresolvedReferenceNode =
  (): GraphNode<typeof AgentState> => async (state) => ({
    messages: [
      new AIMessage(
        state.referenceResolution.clarificationMessage ??
          "我仍无法确认目标球员，请提供完整姓名后再继续。",
      ),
    ],
  });

const createAssistantNode =
  (model: LanguageModelLike): GraphNode<typeof AgentState> =>
  async (state) => {
    const referenceContext =
      state.referenceResolution?.status === "resolved"
        ? formatReferenceContext(state.referenceResolution)
        : "";
    const response = await model.invoke([
      new SystemMessage(
        [assistantPrompt, referenceContext].filter(Boolean).join("\n\n"),
      ),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

const formatReferenceContext = (
  resolution: ReferenceResolutionState,
): string => {
  const candidate = resolution.candidates.find(
    (item) => item.candidateId === resolution.selectedCandidateId,
  );
  const recordSummary =
    candidate?.records
      .map(
        (record) =>
          `${record.provider} ${record.name}${record.competition ? ` / ${record.competition}` : ""}${record.season ? ` / ${record.season}` : ""}`,
      )
      .join("; ") ?? "";
  const identityStatus = resolution.canonicalIdentityId
    ? `身份注册表确认的 Reep ID：${resolution.canonicalIdentityId}。`
    : "用户确认了一个来源记录，但注册表没有跨来源身份链接；不要把其它同名记录合并进来。";
  return `已确认参考球员“${resolution.selectedName ?? resolution.mention}”。${identityStatus}来源记录：${recordSummary}`;
};

const findSelectedCandidate = (
  answer: string,
  resolution: ReferenceResolutionState,
) => {
  const trimmed = answer.trim();
  const number = Number(trimmed);
  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= resolution.candidates.length
  ) {
    return resolution.candidates[number - 1];
  }
  return resolution.candidates.find(
    (candidate) =>
      candidate.candidateId === trimmed ||
      normalizeName(candidate.name) === normalizeName(trimmed),
  );
};

const cleanReferenceAnswer = (answer: string): string =>
  answer
    .trim()
    .replace(
      /^(?:i mean|i meant|i am referring to|我指的是|我说的是|我想说的是|应该是)\s*/i,
      "",
    )
    .replace(/[。.!?？]+$/, "")
    .trim();

const createEmptyResolution = (
  status: "not_required",
  processedMessageId: string | null,
): ReferenceResolutionState => ({
  status,
  mention: null,
  selectedCandidateId: null,
  canonicalIdentityId: null,
  selectedName: null,
  candidates: [],
  candidateCount: 0,
  candidatesTruncated: false,
  processedMessageId,
  attempts: 0,
  clarificationMessage: null,
});

const resumeValueToText = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const answer = item.answer ?? item.text ?? item.candidateId;
    if (typeof answer === "string") return answer;
  }
  return null;
};

const normalizeName = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");

const referenceIntentPattern =
  /(?:替代|接替|接班|替补|代替|替身|取代|类似|相似|接过|比较|对比|对标|参照|强于|胜过|更像|比.{0,24}(?:更|强|快|好|适合|高|低|弱|差)|replacement|replace|successor|substitute|backup|alternative|similar|compare|better than)/i;

export {
  createAssistantNode,
  createReferenceClarificationNode,
  createReferenceMentionExtractor,
  createReferenceResolutionNode,
  createUnresolvedReferenceNode,
};
export type { ReferenceMentionExtractor };
