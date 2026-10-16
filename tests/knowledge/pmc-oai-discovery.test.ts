import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PmcOaiDiscoveryProvider } from "../../src/knowledge/pmc-oai-discovery.js";

const doi = "10.3389/fpsyg.2022.813206";
const pmcid = "PMC9197445";
const source = {
  id: "frontiers-positional-role-2022",
  name: "Frontiers: positional role and player individuality in soccer",
  publisher: "Frontiers in Psychology",
  rightsUrl: `https://www.frontiersin.org/journals/psychology/articles/${doi}/full`,
  license: "CC BY 4.0",
  allowedCorpora: ["methodology"],
  allowedUrlPrefixes: [`https://www.frontiersin.org/journals/psychology/articles/${doi}/full`],
  rights: { automatedFetch: true, persistentStorage: true, aiProcessing: true, display: true },
  rightsVerifiedAt: "2026-10-09",
  rightsNote: "Single-article PMC OAI-PMH use under CC BY 4.0; exclude separately credited third-party material.",
};

function articleMetadata(overrides: { doi?: string; license?: string } = {}) {
  return `<?xml version="1.0"?>
  <OAI-PMH><GetRecord><record><header><identifier>oai:pubmedcentral.nih.gov:9197445</identifier></header><metadata>
    <article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta>
      <article-id pub-id-type="pmcid">${pmcid}</article-id>
      <article-id pub-id-type="doi">${overrides.doi ?? doi}</article-id>
      <article-title>Does Technical Match Performance Depend on Positional Role?</article-title>
      <contrib-group><contrib><name><surname>Forcher</surname><given-names>Leon</given-names></name></contrib></contrib-group>
      <pub-date><year>2022</year></pub-date>
      <permissions><license><ali:license_ref>${overrides.license ?? "https://creativecommons.org/licenses/by/4.0/"}</ali:license_ref><license-p>Creative Commons Attribution 4.0</license-p></license></permissions>
    </article-meta></front></article>
  </metadata></record></GetRecord></OAI-PMH>`;
}

function articleFullText() {
  return `<?xml version="1.0"?>
  <!DOCTYPE OAI-PMH PUBLIC "-//PMC//DTD OAI-PMH//EN" "https://example.invalid/oai.dtd">
  <OAI-PMH><GetRecord><record><header><identifier>oai:pubmedcentral.nih.gov:9197445</identifier></header><metadata>
    <article xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta>
      <article-id pub-id-type="pmcid">${pmcid}</article-id><article-id pub-id-type="doi">${doi}</article-id>
      <permissions><license><ali:license_ref>https://creativecommons.org/licenses/by/4.0/</ali:license_ref></license></permissions>
    </article-meta></front><body>
      <sec><title>Role and individual performance</title>
        <p>Technical match performance varies with positional role and individual player style.</p>
        <fig><caption><p>THIRD PARTY FIGURE CAPTION</p></caption><graphic xlink:href="figure-1"/></fig>
        <table-wrap><caption><p>THIRD PARTY TABLE CAPTION</p></caption><table><tbody><tr><td>excluded</td></tr></tbody></table></table-wrap>
        <supplementary-material><p>THIRD PARTY SUPPLEMENT</p></supplementary-material>
        <ref-list><ref><mixed-citation>THIRD PARTY REFERENCE TEXT</mixed-citation></ref></ref-list>
        <p>The study uses one Bundesliga season and a small sample of players who changed positions.</p>
      </sec>
    </body></article>
  </metadata></record></GetRecord></OAI-PMH>`;
}

async function withProvider(fetcher: typeof fetch, callback: (provider: PmcOaiDiscoveryProvider) => Promise<void>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tactiscout-pmc-oai-"));
  try {
    const registryPath = path.join(tempRoot, "sources.json");
    await writeFile(registryPath, JSON.stringify([source]), "utf8");
    await callback(new PmcOaiDiscoveryProvider({ fetcher, registryPath }));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("a registered CC BY article is fetched only after metadata verification and excludes non-article assets", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    const metadataPrefix = url.searchParams.get("metadataPrefix");
    return new Response(metadataPrefix === "pmc_fm" ? articleMetadata() : articleFullText(), { status: 200 });
  };

  await withProvider(fetcher, async (provider) => {
    const document = await provider.fetchRegisteredArticle(doi);

    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((url) => url.searchParams.get("metadataPrefix")), ["pmc_fm", "pmc"]);
    assert.equal(document.sourceId, source.id);
    assert.equal(document.corpus, "methodology");
    assert.equal(document.acquisition, "authorized_fetch");
    assert.equal(document.license, "CC BY 4.0");
    assert.equal(document.author, "Leon Forcher");
    assert.match(document.content, /positional role and individual player style/);
    assert.match(document.content, /TactiScout-authored Chinese methodology summary/);
    assert.doesNotMatch(document.content, /THIRD PARTY FIGURE|THIRD PARTY TABLE|THIRD PARTY SUPPLEMENT/);
    assert.doesNotMatch(document.content, /THIRD PARTY REFERENCE/);
    assert.match(document.attribution, /10\.3389\/fpsyg\.2022\.813206/);
    assert.match(document.attribution, /CC BY 4\.0/);
  });
});

test("an OAI record with a mismatched DOI or license is rejected before full-text retrieval", async () => {
  let fetchCount = 0;
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(articleMetadata({ license: "https://creativecommons.org/licenses/by-nc/4.0/" }), { status: 200 });
  };

  await withProvider(fetcher, async (provider) => {
    await assert.rejects(provider.fetchRegisteredArticle(doi), /许可/);
  });
  assert.equal(fetchCount, 1);
});

test("an inline entity declaration is rejected and external DTDs are never resolved", async () => {
  let fetchCount = 0;
  const fetcher: typeof fetch = async (input) => {
    fetchCount += 1;
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return new Response(url.searchParams.get("metadataPrefix") === "pmc_fm"
      ? articleMetadata()
      : articleFullText().replace("<!DOCTYPE OAI-PMH PUBLIC \"-//PMC//DTD OAI-PMH//EN\" \"https://example.invalid/oai.dtd\">", "<!DOCTYPE OAI-PMH [<!ENTITY x \"unsafe\">]>").replace("<body>", "<body><!ENTITY injected \"unsafe\">") , { status: 200 });
  };

  await withProvider(fetcher, async (provider) => {
    await assert.rejects(provider.fetchRegisteredArticle(doi), /实体声明|内部 DOCTYPE/);
  });
  assert.equal(fetchCount, 2);
});
