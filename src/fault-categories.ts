const faultCategoryValues = [
  "network",
  "server",
  "timeout",
  "rate_limit",
  "quota",
  "authentication",
  "configuration",
  "invalid_response",
  "attempt_limit",
  "local_data",
] as const;

type FaultCategory = (typeof faultCategoryValues)[number];

export { faultCategoryValues };

export type { FaultCategory };
