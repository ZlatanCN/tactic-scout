import { describe, expect, it, vi } from "vitest";

import { createApiFootballClient } from "../src/team-data/api-football.js";

describe("API-Football client", () => {
  it("searches teams and returns provider identity context", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        errors: [],
        response: [
          {
            team: { country: "England", id: 42, name: "Arsenal" },
            venue: { name: "Emirates Stadium" },
          },
        ],
      })
    );

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    const result = await client.searchTeams("Arsenal");

    expect(result).toStrictEqual({
      data: [
        {
          country: "England",
          id: 42,
          name: "Arsenal",
        },
      ],
      status: "ok",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://v3.football.api-sports.io/teams?search=Arsenal"
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-apisports-key": "test-key",
    });
  });

  it("reuses a successful roster for seven days and refreshes it at expiry", async () => {
    const retrievalTime = new Date("2026-01-01T12:00:00.000Z");
    let currentTime = retrievalTime;

    const squadResponse = {
      errors: [],
      response: [
        {
          players: [{ id: 1001, name: "Player One", position: "Midfielder" }],
          team: { country: "England", id: 42, name: "Arsenal" },
        },
      ],
    };

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(squadResponse))
      .mockResolvedValueOnce(Response.json(squadResponse));

    const client = createApiFootballClient({
      apiKey: "test-key",
      fetcher,
      now: () => new Date(currentTime),
    });

    const firstResult = await client.getSquad(42);
    currentTime = new Date(
      retrievalTime.getTime() + 7 * 24 * 60 * 60 * 1000 - 1
    );
    const cachedResult = await client.getSquad(42);
    currentTime = new Date(retrievalTime.getTime() + 7 * 24 * 60 * 60 * 1000);
    const refreshedResult = await client.getSquad(42);

    expect(firstResult).toMatchObject({
      data: {
        players: [{ id: 1001, name: "Player One", position: "Midfielder" }],
        retrievedAt: "2026-01-01T12:00:00.000Z",
      },
      status: "ok",
    });
    expect(cachedResult).toStrictEqual(firstResult);
    expect(refreshedResult).toMatchObject({ status: "ok" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports missing credentials without making a provider request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createApiFootballClient({ fetcher });

    const result = await client.searchTeams("Arsenal");

    expect(result).toMatchObject({
      reason: "configuration",
      status: "error",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes quota exhaustion from malformed team data", async () => {
    const quotaClient = createApiFootballClient({
      apiKey: "test-key",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          errors: { requests: "Daily requests limit exceeded" },
          response: [],
        })
      ),
    });

    const malformedClient = createApiFootballClient({
      apiKey: "test-key",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          errors: [],
          response: [{ team: { id: "not-a-number", name: "Arsenal" } }],
        })
      ),
    });

    const quotaResult = await quotaClient.searchTeams("Arsenal");
    const malformedResult = await malformedClient.searchTeams("Arsenal");

    expect(quotaResult).toMatchObject({ reason: "quota", status: "error" });
    expect(malformedResult).toMatchObject({
      reason: "provider",
      status: "error",
    });
  });
});
