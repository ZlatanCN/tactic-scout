import type { FastifyReply } from "fastify";
import { RecruitmentSseEventSchema, type RecruitmentSseEvent } from "../../domain/conversation.js";

/** Starts a POST-compatible Server-Sent Events response without changing the turn runtime. */
export function openRecruitmentEventStream(reply: FastifyReply): {
  send: (event: RecruitmentSseEvent) => void;
  ping: () => void;
  close: () => void;
} {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  reply.raw.flushHeaders();
  let closed = false;
  let lastEventAt = Date.now();

  return {
    send(event) {
      if (closed || reply.raw.writableEnded || reply.raw.destroyed) return;
      const parsed = RecruitmentSseEventSchema.parse(event);
      lastEventAt = Date.now();
      reply.raw.write(`event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`);
    },
    ping() {
      // SSE comment line; keeps proxies and browsers from closing an idle stream.
      if (closed || reply.raw.writableEnded || reply.raw.destroyed) return;
      reply.raw.write(`: ping ${Math.round((Date.now() - lastEventAt) / 1000)}s\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
    },
  };
}
