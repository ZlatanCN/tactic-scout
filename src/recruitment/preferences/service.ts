import type { BaseStore } from "@langchain/langgraph";
import {
  MemoryOwnerIdSchema,
  RecruitmentPreferenceKeySchema,
  RecruitmentPreferenceListSchema,
  RecruitmentPreferenceSchema,
  RecruitmentPreferenceWriteSchema,
  preferenceNamespace,
  type RecruitmentPreference,
  type RecruitmentPreferenceKey,
  type RecruitmentPreferenceWrite,
} from "./schemas.js";

const preferenceGuidance: Record<RecruitmentPreferenceKey, string> = {
  analysis_focus: "仅在本次需求未指定分析重点时作为默认参考；本次明确要求始终优先。",
  preferred_competition: "仅在本次需求未指定联赛时作为默认参考；本次明确指定的联赛始终优先。",
};

export class RecruitmentPreferencesService {
  constructor(private readonly store: BaseStore, private readonly now: () => Date = () => new Date()) {}

  async list(memoryOwnerId: string): Promise<RecruitmentPreference[]> {
    const ownerId = MemoryOwnerIdSchema.parse(memoryOwnerId);
    const items = await this.store.search(preferenceNamespace(ownerId), { limit: 10 });
    return RecruitmentPreferenceListSchema.parse(items.flatMap(item => {
      if (!Object.values(RecruitmentPreferenceKeySchema.enum).includes(item.key as RecruitmentPreferenceKey)) return [];
      const parsed = RecruitmentPreferenceSchema.safeParse(item.value);
      return parsed.success && parsed.data.key === item.key ? [parsed.data] : [];
    })).sort((left, right) => left.key.localeCompare(right.key));
  }

  async save(memoryOwnerId: string, input: RecruitmentPreferenceWrite): Promise<RecruitmentPreference> {
    const ownerId = MemoryOwnerIdSchema.parse(memoryOwnerId);
    const write = RecruitmentPreferenceWriteSchema.parse(input);
    const { explicitlyApproved: _approved, ...preferenceValue } = write;
    const preference = RecruitmentPreferenceSchema.parse({
      ...preferenceValue,
      confirmedAt: this.now().toISOString(),
      source: "explicit_user_confirmation",
      appliesWhen: preferenceGuidance[write.key],
    });
    await this.store.put(preferenceNamespace(ownerId), preference.key, preference);
    return preference;
  }

  async delete(memoryOwnerId: string, key: string): Promise<boolean> {
    const ownerId = MemoryOwnerIdSchema.parse(memoryOwnerId);
    const preferenceKey = RecruitmentPreferenceKeySchema.parse(key);
    const namespace = preferenceNamespace(ownerId);
    const existing = await this.store.get(namespace, preferenceKey);
    if (!existing) return false;
    await this.store.delete(namespace, preferenceKey);
    return true;
  }

  async clear(memoryOwnerId: string): Promise<void> {
    const ownerId = MemoryOwnerIdSchema.parse(memoryOwnerId);
    const namespace = preferenceNamespace(ownerId);
    const items = await this.store.search(namespace, { limit: 20 });
    await Promise.all(items.map(item => this.store.delete(namespace, item.key)));
  }
}
