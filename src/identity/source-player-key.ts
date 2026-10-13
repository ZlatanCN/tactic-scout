import type { PlayerProfile } from "../domain/schemas.js";

export function sourcePlayerKey(player: PlayerProfile): string {
  const identity = player.sourceIdentity;
  return identity
    ? JSON.stringify([
      "source",
      identity.provider,
      identity.playerId,
      identity.teamId ?? "",
      identity.competitionId ?? "",
      identity.seasonId ?? "",
    ])
    : JSON.stringify(["player", player.playerId]);
}
