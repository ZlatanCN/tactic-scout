import { type RecruitmentProgressEvent } from "../../../../../src/domain/conversation.js";

const visibleProgressStepCount = 6;

/**
 * Turn lifecycle events into the compact step list shown during an investigation.
 * A completion updates its matching start event; repeated stages remain separate
 * through their occurrence number. The server event snapshot remains untouched.
 */
export function allProgressSteps(events: RecruitmentProgressEvent[]): RecruitmentProgressEvent[] {
  const stepIndexes = new Map<string, number>();
  const steps: RecruitmentProgressEvent[] = [];

  for (const event of events) {
    const key = `${event.stage}:${event.occurrence}`;
    const previousIndex = stepIndexes.get(key);
    if (previousIndex === undefined) {
      stepIndexes.set(key, steps.length);
      steps.push(event);
    } else {
      steps[previousIndex] = event;
    }
  }

  return steps;
}

export function visibleProgressSteps(events: RecruitmentProgressEvent[]): RecruitmentProgressEvent[] {
  return allProgressSteps(events).slice(-visibleProgressStepCount);
}
