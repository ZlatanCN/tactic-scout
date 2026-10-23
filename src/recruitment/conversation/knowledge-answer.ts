import { createHash } from "node:crypto";
import type { KnowledgeAnswer, KnowledgeAnswerCitation, KnowledgeAnswerClaim } from "../../domain/reports.js";
import type { KnowledgeSearchResult } from "../../knowledge/schemas.js";
import type { FinishRecruitmentAction } from "../recruitment-actions.js";

const recruitmentOnlyCopy = /(?:目标画像|候选推荐|候选球员|球队预算|转会可行性|Understat|FM 档案|五大联赛当前赛季|完整注册阵容|Reep 身份索引)/iu;

function citationFor(result: KnowledgeSearchResult): KnowledgeAnswerCitation | null {
  if (!result.evidenceRef || !result.displayAllowed) return null;
  return {
    id: result.id,
    evidenceRef: result.evidenceRef,
    excerpt: result.text.slice(0, 1_200),
    source: {
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      title: result.title,
      url: result.url,
      author: result.author,
      publisher: result.publisher,
      publishedAt: result.publishedAt,
      license: result.license,
      attribution: result.attribution,
    },
  };
}

/**
 * Converts model-selected evidence IDs into a deliverable claim. A claim is
 * emitted only when every selected evidence ID resolves to a currently
 * authorized, displayable source interval. This function cannot invent text.
 */
export function projectKnowledgeAnswerClaim(input: {
  claimId: string;
  text: string;
  evidenceIds: readonly string[];
  retrievedKnowledge: readonly KnowledgeSearchResult[];
}): KnowledgeAnswerClaim | null {
  if (!input.text.trim() || !input.evidenceIds.length
    || new Set(input.evidenceIds).size !== input.evidenceIds.length) return null;
  const byId = new Map(input.retrievedKnowledge.map((result) => [result.id, result]));
  const results = input.evidenceIds.map((id) => byId.get(id));
  if (results.some((result) => !result)) return null;
  const citations = (results as KnowledgeSearchResult[]).map(citationFor);
  if (citations.some((citation) => citation === null)) return null;
  return {
    claimId: input.claimId,
    text: input.text.trim(),
    evidenceIds: [...input.evidenceIds],
    citations: citations as KnowledgeAnswerCitation[],
  };
}

/**
 * Deterministic boundary for knowledge Q&A. It deliberately suppresses all
 * recruitment report copy and refuses a claim whose evidence disappeared.
 */
export function projectKnowledgeAnswer(input: {
  action: FinishRecruitmentAction;
  retrievedKnowledge: readonly KnowledgeSearchResult[];
  abstentionReason?: KnowledgeAnswer["abstentionReason"];
}): KnowledgeAnswer {
  const claims = input.action.methodologyClaims.flatMap((claim) => {
    if (recruitmentOnlyCopy.test(claim.summary)) return [];
    const projected = projectKnowledgeAnswerClaim({
      claimId: createHash("sha256").update(JSON.stringify({
        text: claim.summary,
        evidenceIds: claim.evidenceIds,
      })).digest("hex"),
      text: claim.summary,
      evidenceIds: claim.evidenceIds,
      retrievedKnowledge: input.retrievedKnowledge,
    });
    return projected ? [projected] : [];
  });
  const missingFacts = /(?:无法|不足|缺失|未覆盖|没有找到|缺少|cannot|not supported|insufficient)/iu.test(input.action.needSummary)
    && !recruitmentOnlyCopy.test(input.action.needSummary)
    ? [input.action.needSummary.trim()]
    : [];
  if (claims.length && missingFacts.length) {
    return { status: "partial", claims, missingFacts, abstentionReason: null };
  }
  if (claims.length) {
    return { status: "answered", claims, missingFacts: [], abstentionReason: null };
  }
  return {
    status: "abstained",
    claims: [],
    missingFacts: missingFacts.length ? missingFacts : ["当前检索证据不足以支持所问事实。"],
    abstentionReason: input.abstentionReason ?? "evidence_insufficient",
  };
}
