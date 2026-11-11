import { describe, expect, it, vi } from "vitest";

import { createApiFootballClient } from "../../src/team-data/api-football.js";

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

    if (firstResult.status !== "ok") {
      throw new Error("The first roster fetch should succeed.");
    }

    expect(cachedResult).toStrictEqual({
      cached: true,
      data: firstResult.data,
      status: "ok",
    });
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

  it("throws tagged transient failures for upstream server errors", async () => {
    const client = createApiFootballClient({
      apiKey: "test-key",
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });

    await expect(client.searchTeams("Arsenal")).rejects.toMatchObject({
      fault: {
        category: "server",
        requestsUsed: 1,
        retryable: true,
      },
    });
  });

  it("does not retry a quota error returned with a server status", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "daily_request_limit_reached",
          errors: [],
          response: [],
        },
        { status: 503 }
      )
    );

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    await expect(client.searchTeams("Arsenal")).resolves.toMatchObject({
      providerCode: "daily_request_limit_reached",
      reason: "quota",
      status: "error",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not cache a roster response after a failed fetch", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Player One", position: "Midfielder" },
              ],
              team: { country: "England", id: 42, name: "Arsenal" },
            },
          ],
        })
      );

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    await expect(client.getSquad(42)).rejects.toMatchObject({
      fault: { category: "server", retryable: true },
    });

    const result = await client.getSquad(42);

    expect({
      fetchCalls: fetcher.mock.calls.length,
      name: result.status === "ok" ? result.data.players[0]?.name : null,
    }).toStrictEqual({ fetchCalls: 2, name: "Player One" });
  });

  it("returns retry metadata only for a short limit with positive daily quota", async () => {
    const client = createApiFootballClient({
      apiKey: "test-key",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { code: "rate_limit_exceeded", errors: [], response: [] },
          {
            headers: {
              "retry-after": "2",
              "x-ratelimit-requests-remaining": "4",
            },
            status: 429,
          }
        )
      ),
    });

    const result = await client.searchTeams("Arsenal");

    expect(result).toMatchObject({
      providerCode: "rate_limit_exceeded",
      reason: "rate_limit",
      remainingRequests: 4,
      retryAfterMs: 2000,
      status: "error",
    });
  });

  it("does not infer a retryable short limit from an ambiguous 429", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    const result = await client.searchTeams("Arsenal");

    expect(result).toMatchObject({
      reason: "provider",
      status: "error",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects fractional Retry-After values as invalid retry evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { code: "rate_limit_exceeded", errors: [], response: [] },
        {
          headers: {
            "retry-after": "1.5",
            "x-ratelimit-requests-remaining": "4",
          },
          status: 429,
        }
      )
    );

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    await expect(client.searchTeams("Arsenal")).resolves.toMatchObject({
      reason: "provider",
      status: "error",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects ISO timestamps as invalid HTTP-date retry evidence", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { code: "rate_limit_exceeded", errors: [], response: [] },
        {
          headers: {
            "retry-after": "2026-01-01T12:00:03.000Z",
            "x-ratelimit-requests-remaining": "4",
          },
          status: 429,
        }
      )
    );

    const client = createApiFootballClient({
      apiKey: "test-key",
      fetcher,
      now: () => now,
    });

    await expect(client.searchTeams("Arsenal")).resolves.toMatchObject({
      reason: "provider",
      status: "error",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("treats API authentication failures as permanent", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    const result = await client.searchTeams("Arsenal");

    expect(result).toMatchObject({
      reason: "configuration",
      status: "error",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("parses an HTTP-date Retry-After using the injected clock", async () => {
    const now = new Date("2026-01-01T12:00:00.000Z");

    const client = createApiFootballClient({
      apiKey: "test-key",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          headers: {
            "retry-after": new Date(now.getTime() + 3000).toUTCString(),
            "x-ratelimit-requests-remaining": "4",
          },
          status: 429,
        })
      ),
      now: () => now,
    });

    await expect(client.searchTeams("Arsenal")).resolves.toMatchObject({
      reason: "rate_limit",
      retryAfterMs: 3000,
      status: "error",
    });
  });

  it("checks the remaining HTTP request budget before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    const result = await client.searchTeams("Arsenal", {
      attempt: 4,
    });

    expect(result).toMatchObject({
      reason: "attempt_limit",
      status: "error",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not relabel an unexpected fetcher bug as a transient provider failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fixture programming error"));

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });

    await expect(client.searchTeams("Arsenal")).rejects.toThrow(
      "fixture programming error"
    );
  });

  it("ignores a late roster response after cancellation and does not cache it", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Late Player", position: "Midfielder" },
              ],
              team: { country: "England", id: 42, name: "Arsenal" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          errors: [],
          response: [
            {
              players: [
                { id: 1001, name: "Player One", position: "Midfielder" },
              ],
              team: { country: "England", id: 42, name: "Arsenal" },
            },
          ],
        })
      );

    const client = createApiFootballClient({ apiKey: "test-key", fetcher });
    const controller = new AbortController();
    const pendingRoster = client.getSquad(42, { signal: controller.signal });

    controller.abort();

    await expect(pendingRoster).rejects.toThrow("aborted");

    const nextRoster = await client.getSquad(42);

    expect({
      fetchCalls: fetcher.mock.calls.length,
      playerName:
        nextRoster.status === "ok" ? nextRoster.data.players[0]?.name : null,
    }).toStrictEqual({
      fetchCalls: 2,
      playerName: "Player One",
    });
  });
});
