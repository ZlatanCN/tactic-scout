import { MemoryOwnerIdSchema } from "../../../../../src/recruitment/preferences/schemas.js";

const storageKey = "tactiscout.memoryOwnerId";
let volatileOwnerId: string | undefined;

/** Stable per-browser owner for explicitly approved preferences. */
export function getRecruitmentMemoryOwnerId(): string {
  try {
    const stored = localStorage.getItem(storageKey);
    const parsed = MemoryOwnerIdSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const created = crypto.randomUUID();
    localStorage.setItem(storageKey, created);
    return created;
  } catch {
    volatileOwnerId ??= crypto.randomUUID();
    return volatileOwnerId;
  }
}
