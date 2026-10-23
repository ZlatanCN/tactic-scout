export interface ApplicationAttemptBudget {
  reset(maximum: number): void;
  hasCapacity(): boolean;
  reserve(): boolean;
  completePlannerDispatch(): void;
}

/** Reserves Planner calls against the whole application request, including earlier brief and identity calls. */
export function createApplicationAttemptBudget(
  getCompletedAttempts: () => number,
): ApplicationAttemptBudget {
  let maximum = 0;
  let pendingPlannerAttempts = 0;

  const hasCapacity = (): boolean => getCompletedAttempts() + pendingPlannerAttempts < maximum;

  return {
    reset(nextMaximum) {
      maximum = Math.max(0, Math.floor(nextMaximum));
      pendingPlannerAttempts = 0;
    },
    hasCapacity,
    reserve() {
      if (!hasCapacity()) return false;
      pendingPlannerAttempts += 1;
      return true;
    },
    completePlannerDispatch() {
      pendingPlannerAttempts = 0;
    },
  };
}
