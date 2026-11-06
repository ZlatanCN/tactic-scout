import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod/v4";

type RunningServer = {
  child: ReturnType<typeof spawn>;
  output: () => string;
};

type LocalGateway = {
  calls: () => string[];
  close: () => Promise<void>;
  url: string;
};

const repoRoot = process.cwd();

const apiThreadSchema = z.object({ thread_id: z.string() });

const threadStateSchema = z.looseObject({
  tasks: z
    .array(z.looseObject({ interrupts: z.array(z.unknown()).optional() }))
    .default([]),
  values: z.looseObject({
    conversationContext: z.looseObject({
      activeComparison: z.object({ resultJson: z.string() }),
      activeLookup: z.object({ resultJson: z.string() }),
      activeRecommendation: z.object({ resultJson: z.string() }),
      activeTeamRecommendation: z.object({ resultJson: z.string() }),
    }),
    messages: z
      .array(z.object({ content: z.unknown(), type: z.string() }))
      .default([]),
    outcome: z
      .object({
        kind: z.string().optional(),
        resultJson: z.string().nullable().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
      })
      .nullable(),
    pendingClarification: z
      .object({
        answer: z.string().nullable(),
        kind: z.string(),
        question: z.string(),
      })
      .nullable()
      .optional(),
    request: z.looseObject({
      kind: z.string(),
      players: z
        .array(
          z.looseObject({
            resolution: z
              .looseObject({ status: z.string() })
              .nullable()
              .optional(),
          })
        )
        .optional(),
      recommendation: z
        .object({
          maxAge: z.number().nullable(),
          needsAgeClarification: z.boolean(),
        })
        .optional(),
      teamRecommendation: z
        .looseObject({
          roster: z
            .looseObject({
              members: z.array(
                z.looseObject({
                  fmId: z.string().nullable(),
                  mappingMethod: z.string().nullable(),
                  mappingStatus: z.string(),
                })
              ),
            })
            .nullable(),
        })
        .optional(),
    }),
  }),
});

const storeItemSchema = z.object({
  value: z.object({ confirmed: z.boolean(), sourceIds: z.array(z.string()) }),
});

const tcpAddressSchema = z.object({ port: z.number().int().positive() });

const reservePort = async (): Promise<number> => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = tcpAddressSchema.safeParse(server.address());
  await server[Symbol.asyncDispose]();

  if (!address.success) {
    throw new Error("Expected an available TCP port.");
  }

  return address.data.port;
};

const startGateway = async (): Promise<LocalGateway> => {
  const receivedCalls: string[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      receivedCalls.push(Buffer.concat(chunks).toString("utf-8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              index: 0,
              message: {
                content: "The saved scouting context is ready.",
                role: "assistant",
              },
            },
          ],
          created: 0,
          id: "chatcmpl-persistence-test",
          model: "persistence-test-model",
          object: "chat.completion",
          usage: { completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 },
        })
      );
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = tcpAddressSchema.safeParse(server.address());

  if (!address.success) {
    await server[Symbol.asyncDispose]();
    throw new Error("Expected a local model gateway port.");
  }

  return {
    calls: () => receivedCalls,
    close: async () => {
      server.closeAllConnections();
      await server[Symbol.asyncDispose]();
    },
    url: `http://127.0.0.1:${address.data.port}/v1`,
  };
};

const createTemporaryProject = async (gatewayUrl: string) => {
  const projectPath = await mkdtemp(
    path.join(tmpdir(), "tactiscout-persistence-")
  );

  await Promise.all([
    symlink(
      path.join(repoRoot, "node_modules"),
      path.join(projectPath, "node_modules"),
      "dir"
    ),
    symlink(path.join(repoRoot, "src"), path.join(projectPath, "src"), "dir"),
    symlink(
      path.join(repoRoot, "package.json"),
      path.join(projectPath, "package.json"),
      "file"
    ),
  ]);

  await writeFile(
    path.join(projectPath, "langgraph.json"),
    JSON.stringify({
      dependencies: ["."],
      env: ".env",
      graphs: { agent: "./src/agent.ts:agent" },
      node_version: "22",
    })
  );
  await writeFile(
    path.join(projectPath, ".env"),
    [
      "OPENAI_API_KEY=persistence-test-key",
      "OPENAI_MODEL=persistence-test-model",
      `OPENAI_BASE_URL=${gatewayUrl}`,
      "LANGSMITH_TRACING=false",
      "LANGCHAIN_TRACING_V2=false",
      "API_FOOTBALL_KEY=",
      `TACTISCOUT_FM_PROFILES_PATH=${path.join(projectPath, "missing-fm-profiles.json")}`,
      `TACTISCOUT_UNDERSTAT_DB_PATH=${path.join(projectPath, "missing-understat.sqlite")}`,
      `TACTISCOUT_REEP_IDENTITY_DB_PATH=${path.join(projectPath, "missing-reep.sqlite")}`,
    ].join("\n")
  );

  return projectPath;
};

const startServer = async (
  projectPath: string,
  gatewayUrl: string,
  port: number
): Promise<RunningServer> => {
  let serverOutput = "";
  const readOutput = () => serverOutput;

  const child = spawn(
    process.execPath,
    [
      path.join(
        repoRoot,
        "node_modules",
        "@langchain",
        "langgraph-cli",
        "dist",
        "cli",
        "cli.mjs"
      ),
      "dev",
      "--no-browser",
      "--no-reload",
      "--n-jobs-per-worker",
      "1",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--config",
      path.join(projectPath, "langgraph.json"),
    ],
    {
      cwd: projectPath,
      env: {
        ...process.env,
        API_FOOTBALL_KEY: "",
        LANGCHAIN_API_KEY: "",
        LANGCHAIN_TRACING_V2: "false",
        LANGSMITH_API_KEY: "",
        LANGSMITH_TRACING: "false",
        OPENAI_API_KEY: "persistence-test-key",
        OPENAI_BASE_URL: gatewayUrl,
        OPENAI_MODEL: "persistence-test-model",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  const appendOutput = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString("utf-8")}`.slice(-8000);
  };

  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);

  const pollUntilReady = async (attempt = 0): Promise<boolean> => {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited early: ${readOutput()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/ok`, {
        signal: AbortSignal.timeout(500),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      if (attempt >= 150) {
        throw new Error(
          `Development server did not become ready: ${readOutput()}`
        );
      }

      await delay(100);

      return await pollUntilReady(attempt + 1);
    }

    if (attempt >= 150) {
      throw new Error(
        `Development server did not become ready: ${readOutput()}`
      );
    }

    await delay(100);

    return await pollUntilReady(attempt + 1);
  };

  if (!(await pollUntilReady())) {
    throw new Error(`Development server did not become ready: ${readOutput()}`);
  }

  return { child, output: readOutput };
};

const stopServer = async (running: RunningServer) => {
  if (running.child.exitCode !== null) {
    return;
  }

  const exited = once(running.child, "exit", {
    signal: AbortSignal.timeout(10_000),
  });

  running.child.kill("SIGINT");
  await exited;
};

const waitForServerStop = async (port: number): Promise<void> => {
  const pollUntilStopped = async (attempt = 0): Promise<boolean> => {
    try {
      await fetch(`http://127.0.0.1:${port}/ok`, {
        signal: AbortSignal.timeout(300),
      });
    } catch {
      return true;
    }

    if (attempt >= 100) {
      throw new Error(
        "Development server is still listening after normal shutdown."
      );
    }

    await delay(100);

    return await pollUntilStopped(attempt + 1);
  };

  if (!(await pollUntilStopped())) {
    throw new Error(
      "Development server is still listening after normal shutdown."
    );
  }
};

const requestJson = async <Response>(
  baseUrl: string,
  pathname: string,
  schema: z.ZodType<Response>,
  init: RequestInit = {}
): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${pathname} returned ${response.status}: ${body}`
    );
  }

  return schema.parse(body.length > 0 ? JSON.parse(body) : null);
};

const postJson = async <Response>(
  baseUrl: string,
  pathname: string,
  schema: z.ZodType<Response>,
  body: string
) =>
  await requestJson(baseUrl, pathname, schema, {
    body,
    method: "POST",
  });

const putJson = async (baseUrl: string, pathname: string, body: string) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    body,
    headers: { "content-type": "application/json" },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(
      `PUT ${pathname} returned ${response.status}: ${await response.text()}`
    );
  }
};

const waitResponseSchema = z.unknown();

export {
  apiThreadSchema,
  createTemporaryProject,
  postJson,
  putJson,
  requestJson,
  reservePort,
  startGateway,
  startServer,
  stopServer,
  storeItemSchema,
  threadStateSchema,
  waitForServerStop,
  waitResponseSchema,
};

export type { LocalGateway, RunningServer };
