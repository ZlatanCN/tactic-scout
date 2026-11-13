import { z } from "zod/v4";

const recommendationEvidenceAnswerText = (
  projectionJson: string
): string | null => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(projectionJson);
  } catch {
    return null;
  }

  const projection = z
    .looseObject({
      selectedCandidates: z.array(z.record(z.string(), z.unknown())),
    })
    .safeParse(parsed);

  if (!projection.success) {
    return null;
  }

  const answerLines = projection.data.selectedCandidates.map((candidate) => {
    const values = z
      .object({
        age: z.number().nullable(),
        currentAbility: z.number().nullable(),
        currentDistance: z.number(),
        fmId: z.string(),
        name: z.string(),
        positionRating: z.number(),
        potentialAbility: z.number().nullable(),
        rank: z.number(),
      })
      .safeParse(candidate);

    if (!values.success) {
      return null;
    }

    const item = values.data;

    return `${item.rank}. ${item.name} (FM ID ${item.fmId}; age ${item.age}; position rating ${item.positionRating}; CA ${item.currentAbility}; PA ${item.potentialAbility}; currentDistance ${item.currentDistance})`;
  });

  return answerLines.some((answer) => answer === null)
    ? null
    : answerLines.join("\n");
};

export { recommendationEvidenceAnswerText };
