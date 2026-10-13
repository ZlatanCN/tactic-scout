import { existsSync } from "node:fs";
import path from "node:path";
import { groupCandidatesByExactIdentity, type CandidateIdentityGroup } from "./candidate-groups.js";
import { ReepIdentityRegistry } from "./reep-registry.js";
import type { PlayerProfile } from "../domain/schemas.js";

/** Opens the local Reep index only for this grouping pass and always closes it. */
export function groupCandidatesWithConfiguredReepIndex(records: readonly PlayerProfile[]): CandidateIdentityGroup[] {
  const databasePath = path.resolve(process.cwd(), process.env.TACTISCOUT_REEP_IDENTITY_DB_PATH ?? ".data/reep/identity.sqlite");
  if (!existsSync(databasePath)) return groupCandidatesByExactIdentity(records);

  let registry: ReepIdentityRegistry | undefined;
  try {
    registry = new ReepIdentityRegistry(databasePath);
    return groupCandidatesByExactIdentity(records, registry);
  } catch {
    return groupCandidatesByExactIdentity(records);
  } finally {
    registry?.close();
  }
}
