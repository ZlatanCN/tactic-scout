import { z } from "zod/v4";

import { comparisonResultSchema } from "./player-data/compare-records.js";
import { fmReadResultSchema } from "./player-data/football-manager.js";

const missingBirthDateClaimPattern =
  /出生日期(?:未提供|没有提供)|(?:birth date|date of birth) (?:was )?not provided/iu;

const currentPositionClaimPattern = /当前位置|\bcurrent position\b/iu;
const currentPositionLabelPattern = /当前位置|\bcurrent position\b/giu;

type ComparisonAnswerPlayer = {
  fm: z.output<typeof fmReadResultSchema> | null;
  playerName: string;
};

const birthDateLines = (
  players: ComparisonAnswerPlayer[],
  language: "en" | "zh"
): string[] =>
  players.flatMap(({ fm, playerName }) => {
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

const correctComparisonAnswerForPlayers = (
  answer: string,
  players: ComparisonAnswerPlayer[]
): string | null => {
  const claimsMissingBirthDate = missingBirthDateClaimPattern.test(answer);
  const claimsCurrentPosition = currentPositionClaimPattern.test(answer);

  if (!claimsMissingBirthDate && !claimsCurrentPosition) {
    return null;
  }

  const language = /\p{Script=Han}/u.test(answer) ? "zh" : "en";
  let corrected = answer;

  if (claimsMissingBirthDate) {
    const dates = birthDateLines(players, language);

    if (dates.length > 0) {
      const replacement =
        language === "zh"
          ? `FM 记录中的出生日期：${dates.join("；")}`
          : `FM birth dates on record: ${dates.join("; ")}`;

      corrected = corrected.replace(missingBirthDateClaimPattern, replacement);
    }
  }

  const hasNaturalPosition = players.some(
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

const correctComparisonAnswer = (
  answer: string,
  resultJson: string
): string | null => {
  let rawResult: unknown;

  try {
    rawResult = JSON.parse(resultJson);
  } catch {
    return null;
  }

  const parsed = comparisonResultSchema.safeParse(rawResult);

  return parsed.success && "coverage" in parsed.data
    ? correctComparisonAnswerForPlayers(answer, parsed.data.players)
    : null;
};

const correctComparisonEvidenceBatchAnswer = (
  answer: string,
  projectionJson: string
): string | null => {
  let rawProjection: unknown;

  try {
    rawProjection = JSON.parse(projectionJson);
  } catch {
    return null;
  }

  const parsed = z
    .object({
      selectedPlayers: z.array(
        z.object({
          fm: fmReadResultSchema.nullable(),
          playerName: z.string(),
        })
      ),
    })
    .safeParse(rawProjection);

  return parsed.success
    ? correctComparisonAnswerForPlayers(answer, parsed.data.selectedPlayers)
    : null;
};

export { correctComparisonAnswer, correctComparisonEvidenceBatchAnswer };
