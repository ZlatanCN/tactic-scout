import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import { searchPlayerRecords } from "../player-data/search-records.js";
import type { PlayerSearch } from "../player-data/search-records.js";

const searchInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("每个来源最多返回的记录数"),
  playerName: z.string().min(2).max(100).describe("球员姓名或姓名片段"),
  seasonStartYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe("Understat 赛季起始年份；不填时使用数据库中最新赛季"),
  source: z
    .enum(["understat", "fm", "both"])
    .default("both")
    .describe("要查询的数据来源"),
});

type PlayerSearchInput = z.output<typeof searchInputSchema>;

const createTools = (search: PlayerSearch = searchPlayerRecords) => [
  tool(search, {
    description:
      "按姓名查找本地 Understat 赛季表现记录和/或 Football Manager 能力画像。identityGroups 只合并身份注册表通过 canonical Reep ID 确认关联的来源记录；unlinkedRecords 不可按姓名合并。",
    name: "search_player_records",
    schema: searchInputSchema,
  }),
];

export { createTools };

export type { PlayerSearchInput };
