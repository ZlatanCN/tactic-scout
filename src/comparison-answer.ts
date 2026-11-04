import { comparisonResultSchema } from "./player-data/compare-records.js";

const missingBirthDateClaimPattern =
  /出生日期(?:未提供|没有提供)|(?:birth date|date of birth) (?:was )?not provided/iu;

const birthDateLines = (
  result: Extract<
    ReturnType<typeof comparisonResultSchema.parse>,
    { status: "ready" | "no_comparable_data" }
  >,
  language: "en" | "zh"
): string[] =>
  result.players.flatMap(({ fm, playerName }) => {
    if (fm?.status !== "found") {
      return [];
    }

    const birthDates = [
      ...new Set(
        fm.records.flatMap((record) =>
          record.birthDate === null ? [] : [record.birthDate]
        )
      ),
    ];

    return birthDates.map((birthDate) =>
      language === "zh"
        ? `${playerName} ${birthDate}`
        : `${playerName}: ${birthDate}`
    );
  });

const correctComparisonAnswer = (
  answer: string,
  resultJson: string
): string | null => {
  if (!missingBirthDateClaimPattern.test(answer)) {
    return null;
  }

  let parsed: ReturnType<typeof comparisonResultSchema.safeParse>;

  try {
    parsed = comparisonResultSchema.safeParse(JSON.parse(resultJson));
  } catch {
    return null;
  }

  if (!parsed.success || !("coverage" in parsed.data)) {
    return null;
  }

  const language = /\p{Script=Han}/u.test(answer) ? "zh" : "en";
  const dates = birthDateLines(parsed.data, language);

  if (dates.length === 0) {
    return null;
  }

  const replacement =
    language === "zh"
      ? `FM 记录中的出生日期：${dates.join("；")}`
      : `FM birth dates on record: ${dates.join("; ")}`;

  return answer.replace(missingBirthDateClaimPattern, replacement);
};

export { correctComparisonAnswer };
