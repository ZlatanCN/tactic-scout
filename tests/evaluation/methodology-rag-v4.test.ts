import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { methodologyRetrievalPolicy, LocalKnowledgeBase } from "../../src/knowledge/index.js";
import { compareMethodologyRetrievalV4 } from "../../src/evaluation/methodology-rag-v2-evaluation.js";

const baselineSource = {
  id: "baseline-methods",
  name: "Baseline methods paper",
  publisher: "Example Publisher",
  rightsUrl: "https://methods.example.org/baseline",
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: ["https://methods.example.org/baseline"],
  rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-13",
  rightsNote: "Evaluation fixture.",
} as const;

const candidateSource = {
  ...baselineSource,
  id: "plos-player-profile-2026",
  name: "PLOS player profile methods",
  publisher: "PLOS ONE",
  rightsUrl: "https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0353239",
  allowedUrlPrefixes: ["https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0353239"],
} as const;

function query(
  id: string,
  split: "calibration" | "heldout",
  queryFamily: string,
  answerability: "answerable" | "ambiguous" | "out_of_scope",
  text: string,
  relevantSourceIds: string[],
) {
  return {
    id,
    split,
    queryFamily,
    answerability,
    query: text,
    relevantSourceIds,
    rationale: "Fixed author label for the integration fixture.",
    ...(answerability === "answerable" ? {} : { outOfScopeReason: "The fixed corpus does not answer the full decision request." }),
  };
}

const dataset = {
  datasetId: "methodology-rag-v4",
  corpus: "methodology",
  judgmentLevel: "source",
  judgmentAuthority: "author_labeled",
  embeddingModel: methodologyRetrievalPolicy.embeddingModel,
  retrievalPolicyVersion: methodologyRetrievalPolicy.version,
  candidateSourceId: candidateSource.id,
  sourceIds: [baselineSource.id, candidateSource.id],
  queries: [
    query("cal-baseline-role", "calibration", "calibration-baseline-role", "answerable", "positional role differences in technical actions", [baselineSource.id]),
    query("cal-profile-activity", "calibration", "calibration-profile-volume-efficiency", "answerable", "offensive defensive profiles activity volume efficiency", [candidateSource.id]),
    query("cal-profile-construction", "calibration", "calibration-profile-construction", "answerable", "construct an offensive profile from efficiency and activity indicators", [candidateSource.id]),
    query("cal-ambiguous-transfer", "calibration", "calibration-ambiguous-transfer", "ambiguous", "can performance profiles identify a suitable transfer replacement", [candidateSource.id]),
    query("cal-oos-current-value", "calibration", "calibration-oos-market-value", "out_of_scope", "current transfer value of a named player", []),
    query("held-baseline-role", "heldout", "heldout-baseline-role", "answerable", "how positional roles relate to technical actions", [baselineSource.id]),
    query("held-profile-construction", "heldout", "heldout-profile-construction", "answerable", "construct offensive defensive profiles from activity volume and efficiency", [candidateSource.id]),
    query("held-profile-dimensions", "heldout", "heldout-profile-dimensions", "answerable", "which activity and efficiency dimensions describe an offensive defensive player profile", [candidateSource.id]),
    query("held-profile-recruitment", "heldout", "heldout-ambiguous-recruitment", "ambiguous", "does this profile prove a named recruitment target will fit", [candidateSource.id]),
    query("held-oos-availability", "heldout", "heldout-oos-availability", "out_of_scope", "which players are available for the next transfer window", []),
  ],
} as const;

test("methodology v4 compares source-off and source-on against the same index and frozen retrieval policy", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-methodology-rag-v4-"));
  try {
    const indexPath = path.join(tempRoot, "index");
    const baselineRegistryPath = path.join(tempRoot, "baseline-sources.json");
    const candidateRegistryPath = path.join(tempRoot, "candidate-sources.json");
    await writeFile(baselineRegistryPath, JSON.stringify([baselineSource]), "utf8");
    await writeFile(candidateRegistryPath, JSON.stringify([baselineSource, candidateSource]), "utf8");
    const embedder = {
      modelId: methodologyRetrievalPolicy.embeddingModel,
      async embed(text: string) {
        const normalized = text.toLocaleLowerCase();
        if (/activity|efficiency|offensive|defensive/.test(normalized)) return [1, 0];
        if (/positional|technical actions/.test(normalized)) return [0, 1];
        return [1, 1];
      },
    };
    const baselineKnowledgeBase = new LocalKnowledgeBase({ indexPath, registryPath: baselineRegistryPath, seedDocuments: [], embedder });
    const candidateKnowledgeBase = new LocalKnowledgeBase({ indexPath, registryPath: candidateRegistryPath, seedDocuments: [], embedder });
    await baselineKnowledgeBase.ingest({
      sourceId: baselineSource.id,
      corpus: "methodology",
      title: "Baseline positional role method",
      url: "https://methods.example.org/baseline/role",
      author: "A. Researcher",
      publisher: baselineSource.publisher,
      license: baselineSource.license,
      attribution: "A. Researcher. Baseline positional role method. CC BY 4.0.",
      acquisition: "authorized_fetch",
      content: "The study describes how positional roles relate to technical actions observed in professional football matches.",
    });
    await candidateKnowledgeBase.ingest({
      sourceId: candidateSource.id,
      corpus: "methodology",
      title: "PLOS offensive and defensive profiles",
      url: "https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0353239",
      author: "A. Researcher",
      publisher: candidateSource.publisher,
      license: candidateSource.license,
      attribution: "A. Researcher. PLOS profiles. DOI 10.1371/journal.pone.0353239. CC BY 4.0.",
      acquisition: "authorized_fetch",
      content: "Offensive and defensive player profiles combine match activity volume and efficiency indicators to characterize performance dimensions.",
    });

    const comparison = await compareMethodologyRetrievalV4({ baselineKnowledgeBase, candidateKnowledgeBase, dataset });
    const baselineCandidateQuery = comparison.baseline.queries.find((result) => result.queryId === "held-profile-construction");
    const candidateCandidateQuery = comparison.candidate.queries.find((result) => result.queryId === "held-profile-construction");

    assert.equal(comparison.indexPath, path.resolve(indexPath));
    assert.equal(comparison.embeddingModel, methodologyRetrievalPolicy.embeddingModel);
    assert.equal(comparison.retrievalPolicyVersion, methodologyRetrievalPolicy.version);
    assert.deepEqual(comparison.baseline.queries.map(({ queryId }) => queryId), comparison.candidate.queries.map(({ queryId }) => queryId));
    assert.equal(baselineCandidateQuery?.retrievedAcceptedSourceIds.includes(candidateSource.id), false);
    assert.equal(candidateCandidateQuery?.retrievedAcceptedSourceIds.includes(candidateSource.id), true);
    assert.equal(comparison.heldout.candidateSourceCoverage.baseline, 0);
    assert.equal(comparison.heldout.candidateSourceCoverage.candidate, 1);
    assert.equal(comparison.adoptionGate.passed, true);
    assert.equal(comparison.baseline.productionPolicyConsistency, true);
    assert.equal(comparison.candidate.productionPolicyConsistency, true);

    const differentIndexKnowledgeBase = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "different-index"),
      registryPath: candidateRegistryPath,
      seedDocuments: [],
      embedder,
    });
    await assert.rejects(
      compareMethodologyRetrievalV4({ baselineKnowledgeBase, candidateKnowledgeBase: differentIndexKnowledgeBase, dataset }),
      /同一物理知识索引/,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
