import type { TeamRosterCoverage, TeamRosterSnapshot } from "./contracts.js";

const teamRosterCoverage = (
  roster: TeamRosterSnapshot
): TeamRosterCoverage => ({
  mappedMembers: roster.members.filter(
    (member) => member.mappingStatus === "resolved"
  ).length,
  noLocalProfileMembers: roster.members.filter(
    (member) => member.mappingStatus === "no_profile"
  ).length,
  pendingMembers: roster.members.filter(
    (member) => member.mappingStatus === "pending"
  ).length,
  reepBridgeMappings: roster.members.filter(
    (member) => member.mappingMethod === "reep_bridge"
  ).length,
  totalMembers: roster.members.length,
  userConfirmedMappings: roster.members.filter(
    (member) => member.mappingMethod === "user_confirmation"
  ).length,
});

export { teamRosterCoverage };
