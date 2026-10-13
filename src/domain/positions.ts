import type { Position } from "./schemas.js";

const positionFamilies: Partial<Record<Position, readonly Position[]>> = {
  DEF: ["DEF", "CB", "FB", "LB", "RB", "LWB", "RWB"],
  MID: ["MID", "DM", "CM", "AM"],
  ATT: ["ATT", "WG", "LW", "RW", "ST"],
  FB: ["FB", "LB", "RB", "LWB", "RWB"],
  WG: ["WG", "LW", "RW"],
};

export function positionMatches(actual: Position, requested: Position): boolean {
  return actual === requested || positionFamilies[requested]?.includes(actual) === true;
}
