import type { z } from "zod/v4";

const decodeResultJson = <Schema extends z.ZodType>(
  resultJson: string,
  schema: Schema
) => {
  const value: unknown = JSON.parse(resultJson);
  const data = schema.parse(value);

  return { data, resultJson: JSON.stringify(data) };
};

export { decodeResultJson };
