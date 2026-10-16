import type { Position, SelectablePosition } from "./schemas.js";

/** Product position labels shared by confirmation history and the pitch. */
export const selectablePositionLabels: Record<SelectablePosition, string> = {
  GK: "门将", CB: "中卫", LB: "左后卫", RB: "右后卫", LWB: "左翼卫", RWB: "右翼卫",
  DM: "后腰", CM: "中前卫", AM: "前腰", LW: "左边锋", RW: "右边锋", ST: "中锋",
};

export const positionSelectionGroups = [
  { label: "后防", positions: ["CB", "LB", "RB", "LWB", "RWB"] },
  { label: "中场", positions: ["DM", "CM", "AM"] },
  { label: "锋线", positions: ["LW", "RW", "ST"] },
] as const satisfies readonly { label: string; positions: readonly SelectablePosition[] }[];

export function selectablePositionsFor(position: Position | null): SelectablePosition[] {
  switch (position) {
    case "DEF": return [...positionSelectionGroups[0].positions];
    case "MID": return [...positionSelectionGroups[1].positions];
    case "ATT": return [...positionSelectionGroups[2].positions];
    case "FB": return ["LB", "RB", "LWB", "RWB"];
    case "WG": return ["LW", "RW"];
    case null: return Object.keys(selectablePositionLabels) as SelectablePosition[];
    default: return [position];
  }
}

export function positionSelectionLabel(positions: readonly SelectablePosition[]): string {
  return positions.map((position) => selectablePositionLabels[position]).join("、");
}
