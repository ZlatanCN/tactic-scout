import { createHash } from "node:crypto";
import type { KnowledgeSearchResult } from "../knowledge/schemas.js";
import type { EvaluatedCandidate } from "./recruitment-evidence-evaluator.js";

export type CaseEvidenceField = "metadata" | "body";
export type CaseEvidenceKind = "player_metrics" | "player_report" | "methodology";

export interface CaseEvidenceDirectoryEntry {
  ref: string;
  kind: CaseEvidenceKind;
  title: string;
  playerId?: string;
  availableFields: CaseEvidenceField[];
  contentCharacters: number;
  source?: string;
  timeRange?: string;
}

interface StoredCaseEvidence extends CaseEvidenceDirectoryEntry {
  body: string;
  metadata: Record<string, unknown>;
}

export interface CaseEvidenceIndex {
  caseKey: string;
  turnNumber: number;
  directory: CaseEvidenceDirectoryEntry[];
  byRef: ReadonlyMap<string, StoredCaseEvidence>;
}

export function createCaseEvidenceIndex(input: {
  caseId: string;
  turnNumber: number;
  evaluations: readonly EvaluatedCandidate[];
  documents: readonly KnowledgeSearchResult[];
}): CaseEvidenceIndex {
  const caseKey = hash(input.caseId).slice(0, 12);
  const entries: StoredCaseEvidence[] = [];
  for (const candidate of input.evaluations) {
    const body = JSON.stringify({
      player: {
        playerId: candidate.player.playerId,
        name: candidate.player.name,
        position: candidate.player.position,
        competition: candidate.player.competition,
        season: candidate.player.season,
        minutes: candidate.player.minutes,
        source: candidate.player.source,
      },
      metrics: candidate.evidence,
      ...(candidate.roleFits ? { roleFits: candidate.roleFits } : {}),
      ...(candidate.referenceSimilarity ? { referenceSimilarity: candidate.referenceSimilarity } : {}),
    });
    const metadata = {
      kind: "player_metrics",
      playerId: candidate.player.playerId,
      title: candidate.player.name,
      source: candidate.player.source,
      competition: candidate.player.competition,
      season: candidate.player.season,
      minutes: candidate.player.minutes,
      metricKeys: candidate.evidence.map(metric => metric.key),
    };
    entries.push(makeEntry({ caseKey, turnNumber: input.turnNumber, resourceKey: `player:${candidate.player.playerId}`, kind: "player_metrics", title: candidate.player.name, playerId: candidate.player.playerId, source: candidate.player.source, timeRange: `${candidate.player.competition} · ${candidate.player.season}`, body, metadata }));
  }
  for (const document of input.documents) {
    const kind = document.corpus === "player_report" ? "player_report" : "methodology";
    const metadata = {
      kind,
      documentId: document.documentId,
      title: document.title,
      url: document.url,
      sourceId: document.sourceId,
      sourceName: document.sourceName,
      publisher: document.publisher,
      author: document.author,
      publishedAt: document.publishedAt,
      license: document.license,
      attribution: document.attribution,
      entityIds: document.entityIds,
      entityNames: document.entityNames,
      competition: document.competition,
      season: document.season,
      displayAllowed: document.displayAllowed,
      ...(document.matchedCapabilityGaps ? { matchedCapabilityGaps: document.matchedCapabilityGaps } : {}),
    };
    entries.push(makeEntry({ caseKey, turnNumber: input.turnNumber, resourceKey: `${kind}:${document.id}`, kind, title: document.title, source: document.sourceName, timeRange: [document.competition, document.season].filter(Boolean).join(" · ") || undefined, body: document.text, metadata }));
  }
  const byRef = new Map(entries.map(entry => [entry.ref, entry]));
  return {
    caseKey,
    turnNumber: input.turnNumber,
    directory: entries.map(({ body: _body, metadata: _metadata, ...entry }) => entry),
    byRef,
  };
}

export function readCaseEvidence(index: CaseEvidenceIndex, input: {
  refs: readonly string[];
  fields?: readonly CaseEvidenceField[];
  cursor?: string | null;
  limit?: number;
}) {
  const fields = new Set(input.fields?.length ? input.fields : ["body"]);
  const limit = Math.max(1, Math.min(4_000, Math.floor(input.limit ?? 1_800)));
  const offset = input.cursor === undefined || input.cursor === null ? 0 : Number(input.cursor);
  const cursorIsValid = Number.isSafeInteger(offset) && offset >= 0;
  const results = input.refs.slice(0, 2).map(ref => {
    const refParts = parseRef(ref);
    if (!refParts) return { ref, status: "not_found" as const, content: "该引用格式无效或不存在于本案。", nextCursor: null };
    if (refParts.caseKey !== index.caseKey) return { ref, status: "foreign_case" as const, content: "该证据引用属于其他案件，无法读取。", nextCursor: null };
    if (refParts.turnNumber !== index.turnNumber) return { ref, status: "stale" as const, content: "该证据引用来自较早案件轮次，当前轮次不再接受；请使用当前证据目录中的引用。", nextCursor: null };
    const entry = index.byRef.get(ref);
    if (!entry) return { ref, status: "stale" as const, content: "该证据版本已不在当前案件证据目录中。", nextCursor: null };
    if (!cursorIsValid) return { ref, status: "not_found" as const, content: "读取游标无效。", nextCursor: null };
    const selected: string[] = [];
    if (fields.has("metadata")) selected.push(JSON.stringify(entry.metadata));
    if (fields.has("body")) selected.push(entry.body);
    const content = selected.join("\n").slice(offset, offset + limit);
    const nextOffset = offset + content.length;
    return {
      ref,
      status: "ok" as const,
      kind: entry.kind,
      title: entry.title,
      content,
      nextCursor: nextOffset < selected.join("\n").length ? String(nextOffset) : null,
      hasMore: nextOffset < selected.join("\n").length,
    };
  });
  return {
    results,
    directoryRefusedCount: Math.max(0, input.refs.length - 2),
    note: "只读取当前案件目录中已取得的证据；不会联网、访问本地路径或重新计算指标。摘要/截取片段不是完整原文，hasMore=true 时须沿 nextCursor 继续读取。",
  };
}

function makeEntry(input: {
  caseKey: string;
  turnNumber: number;
  resourceKey: string;
  kind: CaseEvidenceKind;
  title: string;
  playerId?: string;
  source?: string;
  timeRange?: string;
  body: string;
  metadata: Record<string, unknown>;
}): StoredCaseEvidence {
  const version = hash(JSON.stringify([input.resourceKey, input.body, input.metadata])).slice(0, 16);
  const resource = hash(input.resourceKey).slice(0, 16);
  return {
    ref: `ev.${input.caseKey}.${input.turnNumber}.${input.kind}.${resource}.${version}`,
    kind: input.kind,
    title: input.title,
    ...(input.playerId ? { playerId: input.playerId } : {}),
    availableFields: ["metadata", "body"],
    contentCharacters: input.body.length,
    ...(input.source ? { source: input.source } : {}),
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    body: input.body,
    metadata: input.metadata,
  };
}

function parseRef(ref: string): { caseKey: string; turnNumber: number } | null {
  const match = /^ev\.([a-f0-9]{12})\.(\d+)\.(?:player_metrics|player_report|methodology)\.[a-f0-9]{16}\.[a-f0-9]{16}$/.exec(ref);
  if (!match) return null;
  const turnNumber = Number(match[2]);
  return Number.isSafeInteger(turnNumber) && turnNumber >= 0 ? { caseKey: match[1]!, turnNumber } : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
