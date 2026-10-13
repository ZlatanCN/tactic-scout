import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  MethodologyRetrievalV5DatasetSchema,
  compareMethodologyRetrievalV5,
  createCrossLingualMethodologyQueryArms,
} from "../src/evals/methodology-rag-v5-evaluation.js";
import { LocalKnowledgeBase, methodologyRetrievalPolicy } from "../src/knowledge/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v4DatasetPath = path.join(projectRoot, "data", "evaluations", "methodology-rag-v4.json");
const v5DatasetPath = path.join(projectRoot, "data", "evaluations", "methodology-rag-v5-crosslingual.json");

const candidateSourceId = "plos-player-profile-2026";
const controlSourceId = "plos-soccer-analysis-2024";
const allSourceIds = [
  "frontiers-positional-role-2022",
  candidateSourceId,
  "plos-position-specific-physical-performance-2021",
  controlSourceId,
];

function fixtureSource(id: string) {
  return {
    id,
    name: `Method source ${id}`,
    publisher: "Evaluation fixture",
    rightsUrl: "https://example.test/rights",
    license: "CC BY 4.0",
    allowedCorpora: ["methodology"],
    allowedUrlPrefixes: [`https://example.test/${id}/`],
    rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
    rightsVerifiedAt: "2026-10-13",
    rightsNote: "Temporary test fixture only.",
  } as const;
}

async function loadDataset() {
  return MethodologyRetrievalV5DatasetSchema.parse(JSON.parse(await readFile(v5DatasetPath, "utf8")) as unknown);
}

test("v5 query arms change only query language and preserve the same evaluation labels", async () => {
  const dataset = await loadDataset();
  const pair = createCrossLingualMethodologyQueryArms(dataset.queries[0]);

  assert.equal(pair.chinese.arm, "chinese-baseline");
  assert.equal(pair.english.arm, "english-translation");
  assert.equal(pair.chinese.query, dataset.queries[0]?.chineseQuery);
  assert.equal(pair.english.query, dataset.queries[0]?.englishTranslation);
  assert.equal(pair.chinese.id, pair.english.id);
  assert.equal(pair.chinese.queryFamily, pair.english.queryFamily);
  assert.equal(pair.chinese.split, pair.english.split);
  assert.equal(pair.chinese.answerability, pair.english.answerability);
  assert.deepEqual(pair.chinese.relevantSourceIds, pair.english.relevantSourceIds);
  assert.notEqual(pair.chinese.relevantSourceIds, pair.english.relevantSourceIds);
  assert.deepEqual(
    { ...pair.chinese, arm: undefined, query: undefined },
    { ...pair.english, arm: undefined, query: undefined },
  );
});

test("v5 query families are fresh and remain paired within the calibration/held-out split", async () => {
  const [dataset, v4] = await Promise.all([
    loadDataset(),
    readFile(v4DatasetPath, "utf8").then((text) => JSON.parse(text) as { queries: Array<{ queryFamily: string }> }),
  ]);
  const v4Families = new Set(v4.queries.map(({ queryFamily }) => queryFamily));
  const v5Families = dataset.queries.map(({ queryFamily }) => queryFamily);

  assert.equal(dataset.queries.length, 12);
  assert.equal(new Set(v5Families).size, 12);
  assert.ok(v5Families.every((family) => !v4Families.has(family)));
  assert.equal(dataset.queries.filter(({ split }) => split === "calibration").length, 6);
  assert.equal(dataset.queries.filter(({ split }) => split === "heldout").length, 6);
  for (const split of ["calibration", "heldout"] as const) {
    assert.ok(dataset.queries.some((query) => query.split === split && query.answerability === "answerable" && query.relevantSourceIds.includes(candidateSourceId)));
    assert.ok(dataset.queries.some((query) => query.split === split && query.answerability === "ambiguous"));
    assert.ok(dataset.queries.some((query) => query.split === split && query.answerability === "out_of_scope"));
  }
});

test("v5 compares Chinese and English queries on one fixed index without weakening abstention", async () => {
  const dataset = await loadDataset();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-methodology-rag-v5-"));
  try {
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify(allSourceIds.map(fixtureSource)), "utf8");
    const knowledgeBase = new LocalKnowledgeBase({
      indexPath: path.join(tempRoot, "index"),
      registryPath,
      seedDocuments: [],
      embedder: {
        modelId: methodologyRetrievalPolicy.embeddingModel,
        async embed() { return [1, 0]; },
      },
    });
    await knowledgeBase.ingest({
      sourceId: candidateSourceId,
      corpus: "methodology",
      title: "Player-grouped validation and leakage-aware preprocessing",
      url: `https://example.test/${candidateSourceId}/article`,
      author: "A. Researcher",
      publisher: "Evaluation fixture",
      publishedAt: null,
      license: "CC BY 4.0",
      attribution: "A. Researcher. Temporary evaluation fixture.",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      acquisition: "manual_import",
      content: "The study used a player-grouped train-test split so records from one player stayed in one partition. Median imputation, standard scaling and principal component analysis were fitted on training data only to prevent data leakage. The supervised models excluded index-defining variables used to construct the PCA indices from the predictor set to reduce circularity. Repeated player-grouped five-fold cross-validation checked whether model performance was stable beyond one train-test split. The study covered one season in five European leagues and did not report current transfer values or player availability.",
    });
    await knowledgeBase.ingest({
      sourceId: controlSourceId,
      corpus: "methodology",
      title: "Professional soccer practitioners and performance-analysis technology",
      url: `https://example.test/${controlSourceId}/article`,
      author: "B. Researcher",
      publisher: "Evaluation fixture",
      publishedAt: null,
      license: "CC BY 4.0",
      attribution: "B. Researcher. Temporary evaluation fixture.",
      entityIds: [],
      entityNames: [],
      competition: null,
      season: null,
      acquisition: "manual_import",
      content: "The study examined performance-analysis technology through academy practitioners' experiences in one club. Practitioners described how technology can support player development. The single-academy sample limits generalization of conclusions to other clubs, and interpretation still depends on context and professional judgment.",
    });

    const comparison = await compareMethodologyRetrievalV5({ knowledgeBase, dataset });

    assert.equal(comparison.indexPath, path.resolve(tempRoot, "index"));
    assert.equal(comparison.embeddingModel, methodologyRetrievalPolicy.embeddingModel);
    assert.equal(comparison.retrievalPolicyVersion, methodologyRetrievalPolicy.version);
    assert.equal(comparison.policy, methodologyRetrievalPolicy);
    assert.equal(comparison.policy.minimumSourceCosineSimilarity, 0.812);
    assert.equal(comparison.policy.minimumQueryTermCoverageAtAcceptedCosine, 0.5);
    assert.equal(comparison.chineseBaseline.productionPolicyConsistency, true);
    assert.equal(comparison.englishTranslation.productionPolicyConsistency, true);
    assert.equal(comparison.heldout.candidateSourceCoverage.baseline, 0);
    assert.equal(comparison.heldout.candidateSourceCoverage.translated, 1);
    assert.equal(comparison.heldout.overallEvidenceCoverage.translated, 1);
    assert.equal(comparison.heldout.sourcePairPrecision.translated, 1);
    assert.equal(comparison.adoptionGate.noDecreaseInOverallEvidenceCoverage, true);
    assert.equal(comparison.adoptionGate.noDecreaseInSourcePairPrecision, true);
    assert.equal(comparison.heldout.ambiguousUnsupportedAcceptances.translated, 0);
    assert.equal(comparison.heldout.outOfScopeFalseAcceptances.translated, 0);
    assert.equal(comparison.adoptionGate.passed, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
