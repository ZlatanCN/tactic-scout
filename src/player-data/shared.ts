import path from "node:path";

import { z } from "zod/v4";

import type { PlayerSearchSource } from "./contracts.js";

const projectRoot = path.resolve(import.meta.dirname, "../..");

const sourceValueSchema = z.union([z.number(), z.string()]).nullish();

const parseJson = <Schema extends z.ZodType>(
  text: string,
  schema: Schema
): z.output<Schema> => schema.parse(JSON.parse(text));

const normalizePlayerName = (value: string): string =>
  value
    .normalize("NFKD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]/gu, "");

const isLoopbackEndpoint = (value: string | undefined): boolean => {
  if (value === undefined || value.length === 0) {
    return false;
  }

  try {
    const hostname = new URL(value).hostname
      .replaceAll(/^\[|\]$/gu, "")
      .toLowerCase();

    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    );
  } catch {
    return false;
  }
};

const assertModelProcessingAllowed = (source: PlayerSearchSource): void => {
  if (isLoopbackEndpoint(process.env.OPENAI_BASE_URL)) {
    return;
  }

  const requested = source === "both" ? ["understat", "fm"] : [source];

  const disallowed = requested.filter(
    (item) =>
      process.env[`TACTISCOUT_${item.toUpperCase()}_AI_PROCESSING_ALLOWED`] !==
      "true"
  );

  if (disallowed.length > 0) {
    throw new Error(
      `远程模型处理未获配置许可：${disallowed.join(", ")}。请使用本机回环模型，或显式配置对应来源许可。`
    );
  }
};

const resolveDataPath = (
  configuredPath: string | undefined,
  defaultPath: string
): string => path.resolve(projectRoot, configuredPath?.trim() ?? defaultPath);

const numeric = (value: z.input<typeof sourceValueSchema>): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const sourceValueToString = (
  value: z.input<typeof sourceValueSchema>,
  fallback = ""
): string => {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
};

const nullableString = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && value.length > 0 ? value : null;

const firstNonEmptyString = (
  ...values: (string | null | undefined)[]
): string => {
  for (const value of values) {
    if (value !== null && value !== undefined && value.length > 0) {
      return value;
    }
  }

  return "";
};

export {
  assertModelProcessingAllowed,
  firstNonEmptyString,
  normalizePlayerName,
  nullableString,
  numeric,
  parseJson,
  resolveDataPath,
  sourceValueSchema,
  sourceValueToString,
};
