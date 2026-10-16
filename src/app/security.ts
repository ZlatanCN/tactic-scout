import type { FastifyInstance } from "fastify";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    const host = new URL(`http://${hostHeader}`);
    return !host.username && !host.password && isLoopbackHostname(host.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username
      && !url.password
      && isLoopbackHostname(url.hostname.toLocaleLowerCase());
  } catch {
    return false;
  }
}

export function registerLoopbackRequestGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isLoopbackHostHeader(request.headers.host)) {
      return reply.code(403).send({ error: "仅允许从本机访问 TactiScout。" });
    }
    if (request.headers.origin && !isLoopbackOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: "已拒绝来自非本机网页的请求。" });
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return reply.code(403).send({ error: "已拒绝跨站请求。" });
    }
  });
}
