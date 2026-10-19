// Execute paired runs sequentially, alternating arm order to limit systematic order effects.
// A failed arm aborts the experiment before an unmatched later run starts.
export async function runCounterbalancedPairs<T>(
  repetitions: number,
  baseline: (repetition: number) => Promise<T>,
  control: (repetition: number) => Promise<T>,
): Promise<{ baseline: T[]; control: T[] }> {
  const baselineRuns: T[] = [];
  const controlRuns: T[] = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    let baselineRun: T;
    let controlRun: T;
    if (repetition % 2 === 1) {
      baselineRun = await baseline(repetition);
      controlRun = await control(repetition);
    } else {
      controlRun = await control(repetition);
      baselineRun = await baseline(repetition);
    }
    baselineRuns.push(baselineRun);
    controlRuns.push(controlRun);
  }
  return { baseline: baselineRuns, control: controlRuns };
}

export async function runCounterbalancedTriples<T>(
  repetitions: number,
  arms: readonly [
    { id: string; run: (repetition: number) => Promise<T> },
    { id: string; run: (repetition: number) => Promise<T> },
    { id: string; run: (repetition: number) => Promise<T> },
  ],
): Promise<Record<string, T[]>> {
  return runCounterbalancedArms(repetitions, arms);
}

export async function runCounterbalancedArms<T>(
  repetitions: number,
  arms: readonly { id: string; run: (repetition: number) => Promise<T> }[],
): Promise<Record<string, T[]>> {
  if (!Number.isInteger(repetitions) || repetitions < arms.length || arms.length < 2) {
    throw new Error(`At least ${arms.length} repetitions are required to counterbalance ${arms.length} arms.`);
  }
  if (new Set(arms.map(({ id }) => id)).size !== arms.length || arms.some(({ id }) => !id.trim())) {
    throw new Error(`Counterbalanced arms require ${arms.length} distinct, non-empty IDs.`);
  }
  const results = Object.fromEntries(arms.map(({ id }) => [id, [] as T[]])) as Record<string, T[]>;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const offset = (repetition - 1) % arms.length;
    for (let position = 0; position < arms.length; position += 1) {
      const arm = arms[(offset + position) % arms.length]!;
      results[arm.id]!.push(await arm.run(repetition));
    }
  }
  return results;
}
