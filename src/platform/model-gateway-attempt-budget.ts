import { AsyncLocalStorage } from "node:async_hooks";

interface ModelGatewayAttemptBudget {
  maximum: number;
  usage: { attempts: number };
}

const requestBudget = new AsyncLocalStorage<ModelGatewayAttemptBudget>();

export class ModelGatewayAttemptLimitError extends Error {
  constructor(readonly maximum: number) {
    super(`The request reached its ${maximum}-attempt configured gateway limit.`);
    this.name = "ModelGatewayAttemptLimitError";
  }
}

export function isModelGatewayAttemptLimitError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current && !visited.has(current); depth += 1) {
    if (current instanceof ModelGatewayAttemptLimitError) return true;
    visited.add(current);
    if (typeof current !== "object") return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Runs all model adapters in one request under a shared, pre-dispatch gateway cap. */
export function withModelGatewayAttemptBudget<T>(maximum: number, operation: () => Promise<T>): Promise<T> {
  const normalizedMaximum = Math.max(0, Math.floor(maximum));
  const parent = requestBudget.getStore();
  if (parent) {
    return requestBudget.run({ maximum: Math.min(parent.maximum, normalizedMaximum), usage: parent.usage }, operation);
  }
  return requestBudget.run({ maximum: normalizedMaximum, usage: { attempts: 0 } }, operation);
}

/** Called by the configured chat transport immediately before every outbound attempt. */
export function reserveModelGatewayAttempt(): void {
  const active = requestBudget.getStore();
  if (!active) return;
  if (active.usage.attempts >= active.maximum) throw new ModelGatewayAttemptLimitError(active.maximum);
  active.usage.attempts += 1;
}

export function isModelGatewayAttemptBudgetExhausted(): boolean {
  const active = requestBudget.getStore();
  return Boolean(active && active.usage.attempts >= active.maximum);
}

export function modelGatewayAttemptsUsed(): number {
  return requestBudget.getStore()?.usage.attempts ?? 0;
}
