import { ReferenceSimilaritySchema } from "./reference-similarity.js";
import { EvidenceRefSchema } from "./evidence.js";
import { PlayerIdentityIdSchema, PlayerIdentitySourceUrlSchema } from "./player-identity.js";
import { z } from "zod/v4";
import { CapabilityEvidenceSchema, CapabilityMetricKeySchema, RequestedCapabilityCoverageSchema } from "./capabilities.js";
import { DatasetModeSchema, DatasetScopeSchema } from "./datasets.js";
import { ExternalSignalCoverageSchema, HistoricalArchiveCoverageSchema, HistoricalArchiveSampleSchema, PlayerEloSignalSchema, createEmptyExternalSignalCoverage } from "./external-evidence.js";
import { CandidateIdentityCoverageSchema, CandidateIdentityResolutionStatusSchema, CandidateIdentitySourceEvidenceSchema } from "./identity.js";
import { PlayerProfileSchema } from "./players.js";
import { PositionSchema, SelectablePositionSchema } from "./position-contracts.js";
import { UnderstatMatchResearchSchema, UnderstatPlayerResearchSchema, UnderstatTeamResearchSchema } from "./understat-evidence.js";
import { CandidateRoleFitSchema } from "./player-abilities.js";
import { FmSearchCriterionSchema } from "./recruitment-brief.js";

export const PlayerRecommendationSchema = z.object({
  referenceSimilarity: ReferenceSimilaritySchema.optional(),
  roleFits: z.array(CandidateRoleFitSchema).optional(),
  matchedPositions: z.array(SelectablePositionSchema).optional(),
  player: PlayerProfileSchema,
  identityResolution: z.object({
    status: CandidateIdentityResolutionStatusSchema,
    releaseStamp: z.string().nullable(),
    sourceRecordCount: z.number().int().positive(),
  }).optional(),
  sourceEvidenceRecords: z.array(CandidateIdentitySourceEvidenceSchema).default([]),
  rationale: z.string(),
  comparisonNotes: z.array(z.string()).max(3).default([]),
  referenceComparisonNotes: z.array(z.string()).max(4).default([]),
  strengths: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  focusEvidenceKeys: z.array(CapabilityMetricKeySchema),
  evidence: z.array(CapabilityEvidenceSchema),
  externalSignals: z.array(PlayerEloSignalSchema).default([]),
  historicalArchiveSamples: z.array(HistoricalArchiveSampleSchema).default([]),
  reportObservations: z.array(z.object({
    summary: z.string(),
    verificationStatus: z.enum(["unverified", "linked_to_match_data"]),
    linkedMetricKeys: z.array(CapabilityMetricKeySchema),
    documentId: z.string().optional(),
    evidenceRef: EvidenceRefSchema.optional(),
    excerpt: z.string().max(1_200).optional(),
    sampleSummary: z.string().nullable().optional(),
    competition: z.string().nullable().optional(),
    season: z.string().nullable().optional(),
    observedFrom: z.iso.date().nullable().optional(),
    observedTo: z.iso.date().nullable().optional(),
    source: z.object({
      sourceId: z.string(),
      sourceName: z.string(),
      title: z.string(),
      url: z.string().url(),
      author: z.string(),
      publisher: z.string(),
      publishedAt: z.string().nullable(),
      license: z.string(),
      attribution: z.string(),
      evidenceType: z.enum(["methodology", "external_report", "historical_player_analysis", "first_party_observation"]).optional(),
    }),
  })).default([]),
  understatResearch: UnderstatPlayerResearchSchema.optional(),
});

export type PlayerRecommendation = z.infer<typeof PlayerRecommendationSchema>;

export const ReferenceProfileMetricSchema = z.object({
  key: CapabilityMetricKeySchema,
  label: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  definition: z.string().optional(),
});

export const ReportReferenceProfileSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  // Ability-only references have no observed competition or match season.
  competition: z.string(),
  season: z.string(),
  minutes: z.number().nonnegative(),
  metrics: z.array(ReferenceProfileMetricSchema),
});

export type ReportReferenceProfile = z.infer<typeof ReportReferenceProfileSchema>;

export const HistoricalArchiveCandidateEvidenceSchema = z.object({
  player: PlayerProfileSchema,
  samples: z.array(HistoricalArchiveSampleSchema).min(1),
});

export type HistoricalArchiveCandidateEvidence = z.infer<typeof HistoricalArchiveCandidateEvidenceSchema>;

export const EvidenceCoverageSummarySchema = z.object({
  evidenceAvailability: z.enum(["available", "experimentally_withheld"]).optional(),
  evaluatedCandidateCount: z.number().int().nonnegative(),
  evaluatedSourceRecordCount: z.number().int().nonnegative().default(0),
  availableMetricValues: z.number().int().nonnegative(),
  expectedMetricValues: z.number().int().nonnegative(),
  lowSampleCandidates: z.number().int().nonnegative(),
  limitedPeerGroupCandidates: z.number().int().nonnegative(),
});

export type EvidenceCoverageSummary = z.infer<typeof EvidenceCoverageSummarySchema>;

export const MethodologySourceReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  author: z.string().min(1),
  publisher: z.string().min(1),
  publishedAt: z.string().nullable(),
  license: z.string().min(1),
  attribution: z.string().min(1),
});

export type MethodologySourceReference = z.infer<typeof MethodologySourceReferenceSchema>;

export const KnowledgeCoverageSchema = z.object({
  methodologyChunksRetrieved: z.number().int().nonnegative(),
  methodologyOutcome: z.enum(["not_triggered", "found", "not_covered", "no_relevant_evidence", "unavailable"]).default("not_triggered"),
  methodologySearchFailed: z.boolean().default(false),
  methodologySources: z.array(MethodologySourceReferenceSchema).default([]),
  playerReportSearchPerformed: z.boolean(),
  playerReportOutcome: z.enum(["not_triggered", "found", "not_covered", "no_relevant_evidence", "unavailable"]).default("not_triggered"),
  playerReportSearchFailed: z.boolean().default(false),
  playerReportChunksRetrieved: z.number().int().nonnegative(),
});

export type KnowledgeCoverage = z.infer<typeof KnowledgeCoverageSchema>;

export const RecruitmentSearchScopeSchema = z.object({
  excludedTargetTeam: z.string().nullable().optional(),
  excludedCompetitions: z.array(z.string()).optional(),
  positions: z.array(PositionSchema).optional(),
  position: PositionSchema.nullable(),
  maxAge: z.number().int().min(0).max(45).nullable(),
  minAge: z.number().int().min(0).max(45).nullable().optional(),
  agePreference: z.enum(["younger", "older"]).nullable().optional(),
  agePreferenceCoverage: z.object({
    eligibleRecords: z.number().int().nonnegative(),
    knownRecords: z.number().int().nonnegative(),
  }).optional(),
  fmCriteria: z.array(FmSearchCriterionSchema).optional(),
  fmCriterionCoverage: z.array(z.object({
    key: z.string().min(1),
    field: FmSearchCriterionSchema.shape.field,
    strength: FmSearchCriterionSchema.shape.strength,
    eligibleRecords: z.number().int().nonnegative(),
    knownRecords: z.number().int().nonnegative(),
    satisfiedRecords: z.number().int().nonnegative(),
  })).optional(),
  minimumMinutes: z.number().int().nonnegative(),
  competition: z.string().nullable(),
  season: z.string().nullable(),
  source: z.enum(["agent_interpreted", "user_confirmed", "mixed"]),
});

export type RecruitmentSearchScope = z.infer<typeof RecruitmentSearchScopeSchema>;

export const PositionLeadSchema = z.object({
  player: PlayerProfileSchema,
  status: z.enum(["broad_only", "pending", "not_observed", "unavailable"]),
});

export type PositionLead = z.infer<typeof PositionLeadSchema>;

export const RecruitmentReportSchema = z.object({
  requestedPositions: z.array(SelectablePositionSchema).optional(),
  positionCoverage: z.array(z.object({ position: SelectablePositionSchema, confirmedCandidates: z.number().int().nonnegative(), searched: z.boolean(), hasMore: z.boolean() })).optional(),
  targetTeam: z.string().nullable(),
  needSummary: z.string(),
  capabilityProfile: z.array(z.string()),
  referenceProfiles: z.array(ReportReferenceProfileSchema).max(5).default([]),
  referenceNameSource: z.object({
    entityId: PlayerIdentityIdSchema,
    url: PlayerIdentitySourceUrlSchema.optional(),
    mention: z.string().min(1).optional(),
    resolvedName: z.string().min(1).optional(),
    resolutionMethod: z.enum(["wikidata_exact", "tavily_wikidata", "user_confirmed", "local_exact", "verified_alias"]).optional(),
    performanceRecordStatus: z.enum(["observed_in_team_sample", "not_observed_in_team_sample", "observed_in_available_data"]).optional(),
  }).nullable().default(null),
  requestedCapabilityCoverage: z.array(RequestedCapabilityCoverageSchema).default([]),
  evidenceCoverage: EvidenceCoverageSummarySchema,
  externalSignalCoverage: ExternalSignalCoverageSchema.default(() => createEmptyExternalSignalCoverage()),
  historicalArchiveCoverage: HistoricalArchiveCoverageSchema.default({
    status: "not_run",
    disabledReason: null,
    checkedCandidates: 0,
    mappedCandidates: 0,
    matchedCandidates: 0,
    failedCandidates: 0,
  }),
  historicalArchiveCandidates: z.array(HistoricalArchiveCandidateEvidenceSchema).default([]),
  understatTeamResearch: UnderstatTeamResearchSchema.optional(),
  understatMatchResearch: z.array(UnderstatMatchResearchSchema).max(3).default([]),
  candidateIdentityCoverage: CandidateIdentityCoverageSchema.default({
    registryAvailable: false,
    releaseStamp: null,
    sourceRecordCount: 0,
    resolvedIdentityCount: 0,
    resolvedSourceRecordCount: 0,
    unresolvedSourceRecordCount: 0,
    resolutionStatusCounts: [],
  }),
  positionLeads: z.array(PositionLeadSchema).max(12).optional(),
  positionLeadCount: z.number().int().nonnegative().optional(),
  knowledgeCoverage: KnowledgeCoverageSchema.default({
    methodologyChunksRetrieved: 0,
    methodologyOutcome: "not_triggered",
    methodologySearchFailed: false,
    methodologySources: [],
    playerReportSearchPerformed: false,
    playerReportOutcome: "not_triggered",
    playerReportSearchFailed: false,
    playerReportChunksRetrieved: 0,
  }),
  searchScopes: z.array(RecruitmentSearchScopeSchema),
  recommendations: z.array(PlayerRecommendationSchema).max(5),
  limitations: z.array(z.string()),
  dataSource: z.string(),
  datasetMode: DatasetModeSchema,
  datasetScope: DatasetScopeSchema.optional(),
});

export type RecruitmentReport = z.infer<typeof RecruitmentReportSchema>;
