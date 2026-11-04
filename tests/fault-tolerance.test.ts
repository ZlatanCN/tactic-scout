import { describe, expect, it } from "vitest";

import {
  maxExternalRequests,
  modelExecutionTimeoutMs,
  modelRequestTimeoutMs,
  modelTimeoutMs,
} from "../src/fault-tolerance.js";

describe("model execution timeout budget", () => {
  it("leaves enough node time for all bounded model requests and retry waits", () => {
    expect(modelExecutionTimeoutMs).toBe(
      maxExternalRequests * modelTimeoutMs + (maxExternalRequests - 1) * 2000
    );
    expect(modelExecutionTimeoutMs).toBeGreaterThan(
      maxExternalRequests * modelRequestTimeoutMs
    );
  });
});
