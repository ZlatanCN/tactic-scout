import "dotenv/config";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod/v4";

import { createApiFootballClient } from "../src/team-data/api-football.js";
import type { ApiFootballClient } from "../src/team-data/api-football.js";

type CapturedApiResponse = {
  payload: z.output<typeof jsonValueSchema>;
};

const jsonValueSchema = z.json();

type TeamSnapshotCapture = {
  apiFootball: {
    capturedAt: string;
    squadResponses: {
      payload: z.output<typeof jsonValueSchema>;
      teamId: number;
    }[];
    teamSearchResponses: {
      payload: z.output<typeof jsonValueSchema>;
      query: string;
    }[];
  };
  requestedTeams: string[];
  requestCount: number;
  status: "completed" | "partial";
};

const captureArguments = () => {
  const parsed = parseArgs({
    options: {
      "max-api-requests": { type: "string" },
      output: { type: "string" },
      team: { multiple: true, type: "string" },
    },
    strict: true,
  });

  const maximumRequests = z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .refine(Number.isSafeInteger)
    .refine((value) => value > 0)
    .parse(parsed.values["max-api-requests"]);

  const teams = (parsed.values.team ?? []).map((team) => team.trim());

  if (teams.length === 0 || teams.some((team) => team.length < 3)) {
    throw new Error(
      "Provide one or more team names (at least three characters each)."
    );
  }

  return {
    maximumRequests,
    output: path.resolve(
      parsed.values.output ??
        ".data/evals/team-source-captures/team-snapshots.json"
    ),
    teams,
  };
};

const captureTeamSnapshots = async (): Promise<void> => {
  const options = captureArguments();
  const apiKey = process.env.API_FOOTBALL_KEY?.trim() ?? "";

  if (apiKey.length === 0) {
    throw new Error(
      "API_FOOTBALL_KEY must be configured before capturing team snapshots."
    );
  }

  const capturedAt = new Date().toISOString();

  const teamSearchResponses: TeamSnapshotCapture["apiFootball"]["teamSearchResponses"] =
    [];

  const squadResponses: TeamSnapshotCapture["apiFootball"]["squadResponses"] =
    [];

  let requestCount = 0;
  let interrupted = false;

  const fetcher: typeof fetch = async (input, init) => {
    if (requestCount >= options.maximumRequests) {
      interrupted = true;
      throw new Error(
        "The API-Football capture request allowance is exhausted."
      );
    }

    const request = new Request(input, init);
    const url = new URL(request.url);
    requestCount += 1;
    const response = await fetch(request);
    const payloadText = await response.clone().text();

    const parsedPayload = (() => {
      try {
        return jsonValueSchema.safeParse(JSON.parse(payloadText));
      } catch {
        return jsonValueSchema.safeParse(null);
      }
    })();

    if (!parsedPayload.success) {
      throw new Error(
        "API-Football returned a non-JSON response; capture stopped."
      );
    }

    const capturedResponse: CapturedApiResponse = {
      payload: parsedPayload.data,
    };

    if (url.pathname === "/teams") {
      const query = url.searchParams.get("search");

      if (query !== null) {
        teamSearchResponses.push({ ...capturedResponse, query });
      }
    }

    if (url.pathname === "/players/squads") {
      const parsedTeamId = z
        .string()
        .regex(/^\d+$/u)
        .transform(Number)
        .safeParse(url.searchParams.get("team"));

      if (parsedTeamId.success) {
        squadResponses.push({ ...capturedResponse, teamId: parsedTeamId.data });
      }
    }

    return response;
  };

  const client: ApiFootballClient = createApiFootballClient({
    apiKey,
    fetcher,
  });

  const captureTeamAt = async (index: number): Promise<void> => {
    const query = options.teams[index];

    if (query === undefined) {
      return;
    }

    if (requestCount >= options.maximumRequests) {
      interrupted = true;

      return;
    }

    const search = await client.searchTeams(query);

    if (search.status === "error") {
      interrupted = true;

      return;
    }

    if (search.data.length !== 1) {
      interrupted = true;

      return;
    }

    const [team] = search.data;

    if (team === undefined || requestCount >= options.maximumRequests) {
      interrupted = true;

      return;
    }

    const squad = await client.getSquad(team.id);

    if (squad.status === "error") {
      interrupted = true;

      return;
    }

    await captureTeamAt(index + 1);
  };

  await captureTeamAt(0);

  const capture: TeamSnapshotCapture = {
    apiFootball: { capturedAt, squadResponses, teamSearchResponses },
    requestCount,
    requestedTeams: options.teams,
    status:
      !interrupted && squadResponses.length === options.teams.length
        ? "completed"
        : "partial",
  };

  const temporaryPath = `${options.output}.tmp`;

  mkdirSync(path.dirname(options.output), { recursive: true });
  writeFileSync(temporaryPath, JSON.stringify(capture, null, 2), {
    mode: 0o600,
  });
  renameSync(temporaryPath, options.output);
  process.stdout.write(
    `${JSON.stringify(
      {
        output: options.output,
        requestCount,
        status: capture.status,
        teamCount: squadResponses.length,
      },
      null,
      2
    )}\n`
  );

  if (capture.status !== "completed") {
    process.exitCode = 1;
  }
};

const captureWithErrors = async (): Promise<void> => {
  try {
    await captureTeamSnapshots();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unexpected capture failure."}\n`
    );
    process.exitCode = 1;
  }
};

void captureWithErrors();
