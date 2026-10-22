import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PlosDiscoveryProvider } from "../../src/knowledge/plos-discovery.js";

const doi = "10.1371/journal.pone.0282295";

test("PLOS import separates one licensed historical player-analysis passage from methodology and excluded material", async () => {
  let requested = 0;
  const provider = new PlosDiscoveryProvider(async (input) => {
    requested += 1;
    const url = new URL(input.toString());
    if (url.hostname === "api.plos.org") {
      assert.equal(url.searchParams.get("q"), `id:"${doi}"`);
      assert.deepEqual(url.searchParams.get("fl")?.split(","), ["id", "title_display", "author_display", "publication_date", "copyright", "abstract"]);
      return new Response(JSON.stringify({ response: { docs: [{
        id: doi,
        title_display: "Expected goals in football: Improving model performance and demonstrating value",
        author_display: ["James Mead", "Anthony O’Hare", "Paul McMenemy"],
        publication_date: "2023-04-05",
        copyright: "This is an open access article distributed under the terms of the Creative Commons Attribution License.",
        abstract: "This open access study evaluates expected goals models and football performance indicators.",
      }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url.hostname, "journals.plos.org");
    assert.equal(url.pathname, "/plosone/article/file");
    assert.equal(url.searchParams.get("id"), doi);
    assert.equal(url.searchParams.get("type"), "manuscript");
    return new Response(`<?xml version="1.0"?>
      <article>
        <front><article-meta><article-id pub-id-type="doi">${doi}</article-id></article-meta></front>
        <body><sec><title>Results</title>
          <p>In Spain’s La Liga, PlayeRank scores placed surprisingly high (when compared to other competitions) due to the high variability in its entries resulting from the performances of Cristiano Ronaldo and Lionel Messi (widely considered the two best players in the world), alongside other players (e.g., Suarez, Griezmann and Benzema) who also had stellar seasons. This was why the La Liga’s odds ratio value for PlayeRank was the only one within the top five leagues to indicate that the higher the score, the more likely a shot is to be successful.</p>
          <p>The transfer value was obtained from Transfermarkt and compared against Wyscout records.</p>
          <table-wrap><table><tr><td>THIRD-PARTY MATCH VALUES</td></tr></table></table-wrap>
          <ref-list><ref>REFERENCE-ONLY MEDIA ARTICLE</ref></ref-list>
          <p>Authors note that roles have different responsibilities.</p>
        </sec></body>
      </article>`, { status: 200, headers: { "content-type": "application/xml" } });
  }, 0);

  const documents = await provider.fetchRegisteredEvidenceDocuments(doi, {
    registryPath: fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url)),
  });

  assert.equal(requested, 2);
  assert.equal(documents.length, 2);
  const playerAnalysis = documents.find(({ corpus }) => corpus === "player_report");
  const methods = documents.find(({ corpus }) => corpus === "methodology");
  assert.deepEqual(playerAnalysis?.entityIds, ["Q11571", "Q615"]);
  assert.equal(playerAnalysis?.evidenceType, "historical_player_analysis");
  assert.deepEqual(playerAnalysis?.entityNames, ["Cristiano Ronaldo", "Lionel Messi"]);
  assert.match(playerAnalysis?.content ?? "", /Spain’s La Liga, PlayeRank scores/);
  assert.equal(playerAnalysis?.competition, "La Liga");
  assert.equal(playerAnalysis?.season, "2017/18", "the article identifies its analysis dataset season");
  assert.match(playerAnalysis?.sampleSummary ?? "", /does not identify each player's specific match dates/i);
  assert.doesNotMatch(playerAnalysis?.content ?? "", /Transfermarkt|THIRD-PARTY|REFERENCE-ONLY/);
  assert.doesNotMatch(methods?.content ?? "", /PlayeRank scores placed surprisingly high/);
  assert.match(playerAnalysis?.attribution ?? "", /CC BY 4\.0/);
  assert.match(playerAnalysis?.attribution ?? "", /Data Provided by PLOS/);
});

test("the PLOS player-evidence adapter refuses an unregistered DOI before contacting the source", async () => {
  let requested = 0;
  const provider = new PlosDiscoveryProvider(async () => {
    requested += 1;
    throw new Error("unregistered source must not request the provider");
  });
  await assert.rejects(provider.fetchRegisteredEvidenceDocuments("10.1371/journal.pone.0999999", {
    registryPath: fileURLToPath(new URL("../../data/knowledge/sources.json", import.meta.url)),
  }), /尚无允许自动抓取/);
  assert.equal(requested, 0);
});
