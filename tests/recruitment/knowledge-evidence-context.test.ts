import assert from "node:assert/strict";
import test from "node:test";
import { explicitEvidenceSampleScope } from "../../src/recruitment/conversation/knowledge-evidence-context.js";

test("explicit historical sample constraints become server-side retrieval filters", () => {
  assert.deepEqual(explicitEvidenceSampleScope("只看 2017/18 赛季的分析"), { sampleSeasons: ["2017/18"] });
  assert.deepEqual(explicitEvidenceSampleScope("只看 2017/18 或 2018/19 赛季的分析"), { sampleSeasons: ["2017/18", "2018/19"] });
  assert.deepEqual(explicitEvidenceSampleScope("只看 2017/18 至 2021/22 赛季的分析"), {
    sampleSeasons: ["2017/18", "2018/19", "2019/20", "2020/21", "2021/22"],
  });
  assert.deepEqual(explicitEvidenceSampleScope("from 2017/18 through 2018/19"), { sampleSeasons: ["2017/18", "2018/19"] });
  assert.deepEqual(explicitEvidenceSampleScope("2017-2019 calendar years"), {
    sampleFrom: "2017-01-01",
    sampleTo: "2019-12-31",
  });
  assert.deepEqual(explicitEvidenceSampleScope("2019-2020 calendar years"), {
    sampleFrom: "2019-01-01",
    sampleTo: "2020-12-31",
  });
  assert.deepEqual(explicitEvidenceSampleScope("分析 2018-08-01 to 2019-06-30 的表现"), {
    sampleFrom: "2018-08-01",
    sampleTo: "2019-06-30",
  });
  assert.deepEqual(explicitEvidenceSampleScope("只看 2019 至 2021 年的资料"), {
    sampleFrom: "2019-01-01",
    sampleTo: "2021-12-31",
  });
  assert.deepEqual(explicitEvidenceSampleScope("只参考 2020 年之后的数据"), { sampleFrom: "2021-01-01" });
  assert.deepEqual(explicitEvidenceSampleScope("截至 2020 年的样本"), { sampleTo: "2020-12-31" });
  assert.deepEqual(explicitEvidenceSampleScope("before 2018-06-01"), { sampleTo: "2018-05-31" });
  assert.deepEqual(explicitEvidenceSampleScope("截至 2018-06-01"), { sampleTo: "2018-06-01" });
  assert.deepEqual(explicitEvidenceSampleScope("只看 2020-06"), { sampleFrom: "2020-06-01", sampleTo: "2020-06-30" });
  assert.deepEqual(explicitEvidenceSampleScope("through 2020"), { sampleTo: "2020-12-31" });
  assert.deepEqual(explicitEvidenceSampleScope("up to 2020"), { sampleTo: "2020-12-31" });
  assert.deepEqual(explicitEvidenceSampleScope("2020年到2022年"), { sampleFrom: "2020-01-01", sampleTo: "2022-12-31" });
  assert.deepEqual(explicitEvidenceSampleScope("from 2020 until 2021"), { sampleFrom: "2020-01-01", sampleTo: "2021-12-31" });
});

test("relative time constraints fail closed when the corpus cannot prove their boundary", () => {
  for (const text of ["看最近的赛季", "看上赛季表现", "use the latest season", "过去 3 年的数据", "since 2017/18", "2017/18 赛季之后", "分析 2017/18 赛季和最新赛季", "use next season", "next year", "upcoming year", "the next calendar year", "next 2 years", "2017-08 after 2018", "2017/18 到 2023/24", "after 2020 and before 2021", "from 2020 to 2021 until 2022", "from 2020 to 2021 and onwards", "2020-01-01 to 2021-01-01 and onwards", "2020-06-01 onward", "2020-06 onwards", "2020-06-01 following", "2020-06 later"]) {
    assert.deepEqual(explicitEvidenceSampleScope(text), { scopeUnavailable: true }, text);
  }
  for (const text of [
    "2019-06-30 through 2018-08-01",
    "2018-08-01 through 2019-06-30 and after 2020-01-01",
    "from 2018-08 through 2019-06 until 2020",
    "2022-06 to 2020-01",
    "2022 to 2020",
    "before 2018-06-01 and 2019-06-01",
    "before 2020-01 and 2020-03",
    "2020-01-01 before 2021-01-01",
    "before 2020 until 2021",
    "before 2018-08-01 through 2019-06-30",
  ]) {
    assert.deepEqual(explicitEvidenceSampleScope(text), { scopeUnavailable: true }, text);
  }
});

test("a player's birth year is not mistaken for an evidence sample filter", () => {
  assert.deepEqual(explicitEvidenceSampleScope("查看 1987 年出生的球员"), {});
  assert.deepEqual(explicitEvidenceSampleScope("born 2018-06-01 player"), {});
});
