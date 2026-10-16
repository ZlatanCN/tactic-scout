import { type PlayerProfile } from "../../domain/players.js";

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

/** Stable identity within one provider; deliberately does not connect different providers. */
export function sourcePlayerIdentityKey(player: PlayerProfile): string {
  const identity = player.sourceIdentity;
  return identity
    ? JSON.stringify(["source_identity", identity.provider, identity.playerId])
    : JSON.stringify(["player_identity", player.playerId]);
}
