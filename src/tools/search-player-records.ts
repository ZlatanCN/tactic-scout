import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import { searchPlayerRecords } from "../player-data/search-records.js";
import type { PlayerSearch } from "../player-data/search-records.js";
import { createComparePlayerRecordsTool } from "./compare-player-records.js";
import {
  createRecommendPlayerCandidatesTool,
  recommendPlayerCandidates,
} from "./recommend-player-candidates.js";
import type { RecommendPlayerCandidates } from "./recommend-player-candidates.js";
import {
  createRecommendTeamPlayerCandidatesTool,
  recommendTeamPlayerCandidates,
} from "./recommend-team-player-candidates.js";
import type { RecommendTeamPlayerCandidates } from "./recommend-team-player-candidates.js";

const searchInputSchema = z.object({
  seasonStartYear: z
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .describe(
      "用户明确指定 Understat 赛季时传入该赛季起始年份；不填时使用数据库中最新赛季"
    ),
  sourceRecords: z
    .array(
      z.object({
        provider: z.enum(["understat", "fm"]),
        sourceId: z.string().min(1),
      })
    )
    .min(1)
    .describe("身份解析已确认的精确数据源记录，不要自行更换或猜测 ID"),
});

type PlayerSearchInput = z.output<typeof searchInputSchema>;

const createTools = (
  search: PlayerSearch = searchPlayerRecords,
  recommend: RecommendPlayerCandidates = recommendPlayerCandidates,
  recommendTeam: RecommendTeamPlayerCandidates = recommendTeamPlayerCandidates
) => [
  tool(search, {
    description:
      "读取身份解析已确认的精确 Understat 和/或 Football Manager source ID。不得按姓名搜索，也不得替换传入的 source ID。",
    name: "search_player_records",
    schema: searchInputSchema,
  }),
  createComparePlayerRecordsTool(search),
  createRecommendPlayerCandidatesTool(recommend),
  createRecommendTeamPlayerCandidatesTool(recommendTeam),
];

export { createTools };

export type { PlayerSearchInput };
