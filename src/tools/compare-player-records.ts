import { tool } from "@langchain/core/tools";

import {
  comparePlayerRecords,
  comparePlayerRecordsInputSchema,
} from "../player-data/compare-records.js";
import { searchPlayerRecords } from "../player-data/search-records.js";
import type { PlayerSearch } from "../player-data/search-records.js";

const createComparePlayerRecordsTool = (
  search: PlayerSearch = searchPlayerRecords
) =>
  tool(async (input) => await comparePlayerRecords(input, search), {
    description:
      "按已确认的多个球员身份查询并整理可比资料。只比较相同 Understat 赛事和赛季；用户指定联赛时只使用该联赛的表现记录。FM 能力画像单独呈现。players 必须包含所有待比较球员。",
    name: "compare_player_records",
    schema: comparePlayerRecordsInputSchema,
  });

export { createComparePlayerRecordsTool };
