import { afterEach, describe, expect, it } from "vitest";

import {
  apiThreadSchema,
  postJson,
  requestJson,
  startDevServerSession,
  threadStateSchema,
  waitResponseSchema,
} from "../../fixtures/langgraph-dev-server.js";
import { clarificationDetails } from "../../fixtures/persistence-state.js";
import { playerMemoryTest } from "../../fixtures/player-memory.js";

describe("cross-thread identity persistence", () => {
  afterEach(async () => {
    await playerMemoryTest.cleanup();
  });

  it("reuses a cross-provider confirmation through the managed Store after restart", async () => {
    await playerMemoryTest.withSourceFixtures();

    const session = await startDevServerSession(
      "./tests/fixtures/player-memory-agent.ts:agent"
    );

    const { baseUrl } = session;

    const createThread = async () =>
      await postJson(
        baseUrl,
        "/threads",
        apiThreadSchema,
        JSON.stringify({ metadata: { graph_id: "agent" } })
      );

    const runLookup = async (threadId: string, message: string) =>
      await postJson(
        baseUrl,
        `/threads/${threadId}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          input: { messages: [{ content: message, role: "user" }] },
        })
      );

    const getThreadState = async (threadId: string) =>
      await requestJson(
        baseUrl,
        `/threads/${threadId}/state`,
        threadStateSchema
      );

    try {
      const threadA = await createThread();
      await runLookup(threadA.thread_id, "Look up Kylian Mbappé");
      const pendingA = await getThreadState(threadA.thread_id);

      const candidates =
        pendingA.values.request.players?.[0]?.resolution?.candidates ?? [];

      const candidateIdForSource = (
        provider: "fm" | "understat",
        sourceId: string
      ) =>
        candidates.find((candidate) =>
          candidate.records.some(
            (record) =>
              record.provider === provider && record.sourceId === sourceId
          )
        )?.candidateId;

      const fmCandidateId = candidateIdForSource("fm", "fm-mbappe");

      const understatCandidateId = candidateIdForSource(
        "understat",
        "understat-mbappe"
      );

      if (fmCandidateId === undefined || understatCandidateId === undefined) {
        throw new Error(
          "The managed Store thread did not return both sources."
        );
      }

      await postJson(
        baseUrl,
        `/threads/${threadA.thread_id}/runs/wait`,
        waitResponseSchema,
        JSON.stringify({
          assistant_id: "agent",
          command: {
            resume: {
              candidateIds: [fmCandidateId, understatCandidateId],
            },
          },
        })
      );

      const confirmed = await getThreadState(threadA.thread_id);
      const threadB = await createThread();
      await runLookup(threadB.thread_id, "Look up Kylian Mbappe");
      const stateB = await getThreadState(threadB.thread_id);
      await session.restart();
      const threadC = await createThread();
      await runLookup(threadC.thread_id, "Look up Kylian Mbappe");
      const stateC = await getThreadState(threadC.thread_id);

      expect({
        confirmed: playerMemoryTest.selectedServerIdentity(confirmed),
        pending: clarificationDetails(pendingA),
        threadB: {
          clarification: clarificationDetails(stateB),
          identity: playerMemoryTest.selectedServerIdentity(stateB),
        },
        threadC: {
          clarification: clarificationDetails(stateC),
          identity: playerMemoryTest.selectedServerIdentity(stateC),
        },
      }).toStrictEqual({
        confirmed: {
          canonicalIdentityId: null,
          identityBasis: "thread_confirmed",
          records: [
            {
              canonicalIdentityId: "canonical:mbappe",
              identityVerified: true,
              provider: "fm",
              sourceId: "fm-mbappe",
            },
            {
              canonicalIdentityId: null,
              identityVerified: false,
              provider: "understat",
              sourceId: "understat-mbappe",
            },
          ],
          status: "resolved",
        },
        pending: {
          hasInterrupt: true,
          question:
            "“Kylian Mbappé”匹配到多个同名候选。请回复候选编号，或补充球队、赛事或赛季；多个编号（例如 1,2）表示你确认这些来源记录属于同一人。",
        },
        threadB: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
            canonicalIdentityId: null,
            identityBasis: "thread_confirmed",
            records: [
              {
                canonicalIdentityId: "canonical:mbappe",
                identityVerified: true,
                provider: "fm",
                sourceId: "fm-mbappe",
              },
              {
                canonicalIdentityId: null,
                identityVerified: false,
                provider: "understat",
                sourceId: "understat-mbappe",
              },
            ],
            status: "resolved",
          },
        },
        threadC: {
          clarification: { hasInterrupt: false, question: null },
          identity: {
            canonicalIdentityId: null,
            identityBasis: "thread_confirmed",
            records: [
              {
                canonicalIdentityId: "canonical:mbappe",
                identityVerified: true,
                provider: "fm",
                sourceId: "fm-mbappe",
              },
              {
                canonicalIdentityId: null,
                identityVerified: false,
                provider: "understat",
                sourceId: "understat-mbappe",
              },
            ],
            status: "resolved",
          },
        },
      });
    } finally {
      await session.close();
    }
  }, 180_000);
});
