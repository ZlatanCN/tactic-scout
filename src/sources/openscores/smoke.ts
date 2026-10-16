const MCP_ENDPOINT = "https://api.openscores.ai/mcp/";
const MAX_REQUESTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const REQUIRED_TOOLS = [
  "list_leagues",
  "list_seasons",
  "list_fixtures",
  "get_fixture",
  "get_standings",
  "search_teams",
  "get_team",
  "search_players",
  "get_player",
] as const;

type JsonRecord = Record<string, unknown>;

export interface OpenScoresSmokeOptions {
  apiKey: string;
  teamName?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface OpenScoresSmokeResult {
  checkedAt: string;
  teamName: string;
  toolNames: string[];
  requestsMade: number;
  teamFieldCoverage: Record<string, boolean>;
  squadRows: number | null;
  squadFieldCoverage: Record<string, number>;
}

export class OpenScoresSmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenScoresSmokeError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function safeHttpError(status: number): string {
  if (status === 401 || status === 403) return "OpenScores rejected the configured API key or access.";
  if (status === 429) return "OpenScores rate limit was reached. The smoke does not retry requests.";
  return `OpenScores returned HTTP ${status}.`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OpenScoresSmokeError("OpenScores returned an unsupported MCP response format.");
  }
}

function parseSse(text: string, requestId: number): unknown {
  const messages = text
    .split(/\r?\n\r?\n/)
    .flatMap((event) => {
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return [];
      try {
        return [JSON.parse(data) as unknown];
      } catch {
        return [];
      }
    });
  const matching = messages.find((message) => isRecord(message) && message.id === requestId);
  if (!matching) throw new OpenScoresSmokeError("OpenScores did not return the matching MCP response.");
  return matching;
}

function parseRpcEnvelope(value: unknown, requestId: number): JsonRecord {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.id !== requestId) {
    throw new OpenScoresSmokeError("OpenScores returned an invalid MCP response envelope.");
  }
  if (isRecord(value.error)) throw new OpenScoresSmokeError("OpenScores rejected an MCP request.");
  if (!isRecord(value.result)) throw new OpenScoresSmokeError("OpenScores returned an unsupported MCP result.");
  return value.result;
}

function fieldProperties(tool: JsonRecord): JsonRecord {
  const schema = isRecord(tool.inputSchema) ? tool.inputSchema : null;
  const properties = schema && isRecord(schema.properties) ? schema.properties : null;
  if (!schema || schema.type !== "object" || !properties) {
    throw new OpenScoresSmokeError("OpenScores changed a required tool input schema.");
  }
  return properties;
}

function requiredArgumentType(tool: JsonRecord, name: string, accepted: readonly string[]): string {
  const properties = fieldProperties(tool);
  const definition = isRecord(properties[name]) ? properties[name] : null;
  const type = nonEmptyString(definition?.type);
  if (!type || !accepted.includes(type)) {
    throw new OpenScoresSmokeError("OpenScores changed a required tool input schema.");
  }
  return type;
}

function validateToolCatalog(result: JsonRecord): Map<string, JsonRecord> {
  if (result.nextCursor !== undefined && result.nextCursor !== null) {
    throw new OpenScoresSmokeError("OpenScores tool catalog is paginated; this smoke will not follow extra pages.");
  }
  if (!Array.isArray(result.tools) || result.tools.some((tool) => !isRecord(tool))) {
    throw new OpenScoresSmokeError("OpenScores returned an unsupported tool catalog.");
  }
  const tools = result.tools as JsonRecord[];
  const byName = new Map<string, JsonRecord>();
  for (const tool of tools) {
    const name = nonEmptyString(tool.name);
    if (name) byName.set(name, tool);
  }
  if (REQUIRED_TOOLS.some((name) => !byName.has(name))) {
    throw new OpenScoresSmokeError("OpenScores is missing one or more documented tools.");
  }
  requiredArgumentType(byName.get("search_teams")!, "q", ["string"]);
  requiredArgumentType(byName.get("get_team")!, "team_id", ["integer", "number", "string"]);
  return byName;
}

function unwrapToolValue(result: JsonRecord): unknown {
  if (result.isError === true) throw new OpenScoresSmokeError("OpenScores tool execution failed.");
  if (Object.hasOwn(result, "structuredContent")) return result.structuredContent;
  if (!Array.isArray(result.content)) throw new OpenScoresSmokeError("OpenScores returned an unsupported tool result.");
  const textBlock = result.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!isRecord(textBlock) || typeof textBlock.text !== "string") {
    throw new OpenScoresSmokeError("OpenScores returned an unsupported tool result.");
  }
  return parseJson(textBlock.text);
}

function collection(value: unknown): JsonRecord[] {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.some((entry) => !isRecord(entry))) {
    throw new OpenScoresSmokeError("OpenScores returned an unsupported paginated collection shape.");
  }
  return value.items as JsonRecord[];
}

function exactNamedRecord(records: JsonRecord[], wanted: string, label: string): JsonRecord {
  const matches = records.filter((record) => nonEmptyString(record.name)?.toLocaleLowerCase() === wanted.toLocaleLowerCase());
  if (matches.length === 0) throw new OpenScoresSmokeError(`No exact ${label} match was returned.`);
  if (matches.length > 1) throw new OpenScoresSmokeError(`More than one exact ${label} match was returned.`);
  return matches[0]!;
}

function normalizeIdArgument(id: string, type: string): string | number {
  if (type === "string") return id;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId)) throw new OpenScoresSmokeError("OpenScores returned an ID that does not match its tool schema.");
  return numericId;
}

function squadFrom(team: JsonRecord): JsonRecord[] | null {
  if (!("current_season_squad" in team)) return null;
  if (!Array.isArray(team.current_season_squad) || team.current_season_squad.some((row) => !isRecord(row))) {
    throw new OpenScoresSmokeError("OpenScores returned an unsupported current-season squad field.");
  }
  return team.current_season_squad as JsonRecord[];
}

function rowFieldPresent(row: JsonRecord, fields: readonly string[]): boolean {
  const player = isRecord(row.player) ? row.player : null;
  return fields.some((field) => {
    if (field in row && row[field] !== null && row[field] !== undefined) return true;
    return player !== null && field in player && player[field] !== null && player[field] !== undefined;
  });
}

function squadCoverage(rows: JsonRecord[]): Record<string, number> {
  const definitions: Record<string, readonly string[]> = {
    id: ["id", "player_id"],
    name: ["name", "player_name"],
    position: ["position", "position_name"],
    nationality: ["nationality", "country"],
    dateOfBirth: ["date_of_birth", "dateOfBirth", "dob"],
    age: ["age"],
    appearances: ["appearances", "recent_appearances"],
    statistics: ["statistics", "stats", "career_aggregates"],
  };
  return Object.fromEntries(Object.entries(definitions).map(([field, keys]) => [
    field,
    rows.reduce((count, row) => count + (rowFieldPresent(row, keys) ? 1 : 0), 0),
  ]));
}

export async function runOpenScoresSmoke(options: OpenScoresSmokeOptions): Promise<OpenScoresSmokeResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new OpenScoresSmokeError("Set OPENSCORES_API_KEY locally before running this smoke.");
  const teamName = (options.teamName ?? "Arsenal").trim();
  if (!teamName) throw new OpenScoresSmokeError("Set an exact team name.");
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new OpenScoresSmokeError("Request timeout must be a positive number of milliseconds.");
  const fetchImpl = options.fetchImpl ?? fetch;
  let requestId = 0;

  const rpc = async (method: string, params?: JsonRecord): Promise<JsonRecord> => {
    if (requestId >= MAX_REQUESTS) throw new OpenScoresSmokeError("OpenScores smoke request budget was exhausted.");
    requestId += 1;
    const id = requestId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(MCP_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      });
      if (!response.ok) throw new OpenScoresSmokeError(safeHttpError(response.status));
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new OpenScoresSmokeError("OpenScores response exceeded the smoke size limit.");
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const body = contentType.includes("text/event-stream") ? parseSse(text, id) : parseJson(text);
      return parseRpcEnvelope(body, id);
    } catch (error) {
      if (error instanceof OpenScoresSmokeError) throw error;
      if (controller.signal.aborted) throw new OpenScoresSmokeError("OpenScores request timed out.");
      throw new OpenScoresSmokeError("OpenScores could not be reached or redirected.");
    } finally {
      clearTimeout(timeout);
    }
  };

  const catalog = validateToolCatalog(await rpc("tools/list"));
  const toolNames = [...catalog.keys()].sort();
  const callTool = async (name: string, args: JsonRecord = {}): Promise<unknown> => {
    const result = await rpc("tools/call", { name, arguments: args });
    return unwrapToolValue(result);
  };
  const teamRows = collection(await callTool("search_teams", { q: teamName }));
  const teamMatch = exactNamedRecord(teamRows, teamName, "team");
  const teamId = identifier(teamMatch.id);
  if (!teamId) throw new OpenScoresSmokeError("The selected team did not include a usable provider ID.");
  const teamIdType = requiredArgumentType(catalog.get("get_team")!, "team_id", ["integer", "number", "string"]);
  const teamValue = await callTool("get_team", { team_id: normalizeIdArgument(teamId, teamIdType) });
  if (!isRecord(teamValue)) throw new OpenScoresSmokeError("OpenScores returned an unsupported team profile.");
  const team = teamValue;
  const returnedTeamId = identifier(team.id);
  if (!returnedTeamId || returnedTeamId !== teamId) throw new OpenScoresSmokeError("OpenScores returned a different or unidentified team.");
  const returnedTeamName = nonEmptyString(team.name);
  if (returnedTeamName?.toLocaleLowerCase() !== teamName.toLocaleLowerCase()) {
    throw new OpenScoresSmokeError("OpenScores returned a different team profile.");
  }
  const squadRows = squadFrom(team);
  const now = (options.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) throw new OpenScoresSmokeError("Smoke clock returned an invalid time.");
  return {
    checkedAt: now.toISOString(),
    teamName: returnedTeamName,
    toolNames,
    requestsMade: requestId,
    teamFieldCoverage: {
      id: Boolean(returnedTeamId),
      name: Boolean(returnedTeamName),
      squad: squadRows !== null,
    },
    squadRows: squadRows?.length ?? null,
    squadFieldCoverage: squadRows ? squadCoverage(squadRows) : {},
  };
}
