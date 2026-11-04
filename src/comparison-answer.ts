import { comparisonResultSchema } from "./player-data/compare-records.js";

const missingBirthDateClaimPattern =
  /出生日期(?:未提供|没有提供)|(?:birth date|date of birth) (?:was )?not provided/iu;

const currentPositionClaimPattern = /当前位置|\bcurrent position\b/iu;
const currentPositionLabelPattern = /当前位置|\bcurrent position\b/giu;

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
  const claimsMissingBirthDate = missingBirthDateClaimPattern.test(answer);
  const claimsCurrentPosition = currentPositionClaimPattern.test(answer);

  if (!claimsMissingBirthDate && !claimsCurrentPosition) {
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
  let corrected = answer;

  if (claimsMissingBirthDate) {
    const dates = birthDateLines(parsed.data, language);

    if (dates.length > 0) {
      const replacement =
        language === "zh"
          ? `FM 记录中的出生日期：${dates.join("；")}`
          : `FM birth dates on record: ${dates.join("; ")}`;

      corrected = corrected.replace(missingBirthDateClaimPattern, replacement);
    }
  }

  const hasNaturalPosition = parsed.data.players.some(
    ({ fm }) =>
      fm?.status === "found" &&
      fm.records.some(({ naturalPositions }) => naturalPositions !== null)
  );

  if (claimsCurrentPosition && hasNaturalPosition) {
    corrected = corrected.replaceAll(
      currentPositionLabelPattern,
      language === "zh" ? "自然位置" : "natural position"
    );
  }

  return corrected === answer ? null : corrected;
};

export { correctComparisonAnswer };
