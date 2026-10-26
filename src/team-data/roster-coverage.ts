import type { TeamRosterSnapshot } from "./contracts.js";

const teamRosterCoverage = (roster: TeamRosterSnapshot) => ({
  mappedMembers: roster.members.filter(
    (member) => member.mappingStatus === "resolved"
  ).length,
  noLocalProfileMembers: roster.members.filter(
    (member) => member.mappingStatus === "no_profile"
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
