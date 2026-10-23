import { AIMessage } from "@langchain/core/messages";
import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod/v4";
import { FinishLimitationKeySchema, RecruitmentActionSchema, type ParsedRecruitmentAction, type RecruitmentPlannerAction, type ToolActionName, toolBudgets } from "./recruitment-actions.js";

const toolDescriptions: Record<RecruitmentPlannerAction, string> = {
  inspect_team: "读取指定球队在当前数据源中的样本，并检查用户提到的参考球员线索。",
  inspect_player: "读取一名已发现球员的可用详细资料。",
  inspect_candidate_group: "读取一组已发现候选球员的可用详细资料。",
  inspect_match: "读取一个已知比赛 ID 对应的名单和射门记录。",
  search_candidates: "按当前招募需求搜索球员。仅使用当前图状态提供的候选范围与下一页游标。",
  search_methodology: "按同一方法学主题检索一个首轮子查询计划（最多三个 query）或一轮补查（最多两个 query）；所有 query 必须能由同一类方法资料回答。",
  search_player_reports: "按本轮已评估候选人和同一时间范围检索首轮子查询计划（最多三个 query）或一轮补查（最多两个 query）；检索对象由系统按案件状态限定，不要填写球员姓名。",
  evaluate_candidates: "评估已发现且符合当前资格条件的候选球员。",
  ask_user: "提出一个会实质改变调查方向、且现有数据工具无法解决的澄清问题。",
  finish: "依据当前已核验证据结束本轮调查并形成有限结论。",
};

type ActionToolDefinition = {
  name: RecruitmentPlannerAction;
  description: string;
  schema: z.ZodObject<any>;
};

function actionToolDefinitions(actionSchema: unknown): ActionToolDefinition[] {
  const schema = actionSchema as { options?: unknown[]; shape?: Record<string, unknown> };
  const variants = Array.isArray(schema.options) ? schema.options : [actionSchema];
  const result: ActionToolDefinition[] = [];
  for (const variant of variants) {
    const object = variant as { shape?: Record<string, unknown>; omit?: (mask: { action: true; targetTeam?: true; playerNames?: true }) => z.ZodObject<any> };
    const discriminator = object.shape?.action as { value?: unknown } | undefined;
    const name = discriminator?.value;
    if (typeof name !== "string" || !(name in toolDescriptions) || typeof object.omit !== "function") continue;
    const actionName = name as RecruitmentPlannerAction;
    const omitMask = {
      action: true as const,
      ...(object.shape && "targetTeam" in object.shape ? { targetTeam: true as const } : {}),
      ...(actionName === "search_player_reports" && object.shape && "playerNames" in object.shape ? { playerNames: true as const } : {}),
    };
    const toolSchema = object.omit(omitMask);
    result.push({ name: actionName, description: toolDescriptions[actionName], schema: toolSchema });
  }
  return result;
}

export function recruitmentToolInputSchema(name: ToolActionName): z.ZodObject<any> {
  const definition = actionToolDefinitions(RecruitmentActionSchema).find(item => item.name === name);
  if (!definition) throw new Error(`Missing schema for recruitment tool ${name}.`);
  return definition.schema;
}

export function recruitmentToolDescription(name: RecruitmentPlannerAction): string {
  return toolDescriptions[name];
}

export function recruitmentPlannerToolManifest(actionSchema: unknown) {
  return actionToolDefinitions(actionSchema).map(({ name, description, schema }) => ({
    type: "function" as const,
    function: {
      name,
      description,
      parameters: z.toJSONSchema(schema),
    },
  }));
}

export function createRecruitmentPlannerTools(actionSchema: unknown): DynamicStructuredTool[] {
  return actionToolDefinitions(actionSchema).map(({ name, description, schema }) => tool(
    async (input) => JSON.stringify(input),
    { name, description, schema },
  ));
}

export class RecruitmentToolProtocolError extends Error {
  constructor(
    readonly failure: "missing_tool_call" | "multiple_tool_calls" | "unknown_tool" | "invalid_arguments",
    readonly toolCallCount: number,
    readonly issuePaths: string[] = [],
    readonly issueCodes: string[] = [],
  ) {
    super(failure === "multiple_tool_calls"
      ? "Planner 必须每次只提出一个具名工具调用。"
      : failure === "missing_tool_call"
        ? "Planner 没有返回具名工具调用。"
        : failure === "unknown_tool"
          ? "Planner 请求了当前阶段未开放的工具。"
          : "Planner 返回的工具参数不符合案件动作约束。");
    this.name = "RecruitmentToolProtocolError";
  }
}

/** OpenAI returns native tool calls; in-process planners may return a typed domain action directly. */
export type RecruitmentPlannerOutput = AIMessage | ParsedRecruitmentAction;

export function parseRecruitmentPlannerOutput(
  output: RecruitmentPlannerOutput,
  availableActions?: readonly RecruitmentPlannerAction[],
  targetTeam?: string | null,
): { action: ParsedRecruitmentAction; nativeMessage: AIMessage } {
  if (!(output instanceof AIMessage)) {
    const parsed = RecruitmentActionSchema.safeParse(normalizePlannerActionPayload(output, targetTeam));
    if (!parsed.success) {
      const issuePaths = [...new Set(parsed.error.issues.map(issue => issue.path.map(String).join(".") || "$"))].slice(0, 8);
      const issueCodes = [...new Set(parsed.error.issues.map(issue => `${issue.path.map(String).join(".") || "$"}:${issue.code}`))].slice(0, 8);
      throw new RecruitmentToolProtocolError("invalid_arguments", 1, issuePaths, issueCodes);
    }
    // In-process planners may propose beyond the current menu; the graph's
    // deterministic validate_decision node is the authoritative action gate.
    return { action: parsed.data, nativeMessage: messageForRecruitmentAction(parsed.data, "typed-planner-action") };
  }
  const calls = output.tool_calls ?? [];
  if (calls.length === 0) throw new RecruitmentToolProtocolError("missing_tool_call", 0);
  if (calls.length !== 1) throw new RecruitmentToolProtocolError("multiple_tool_calls", calls.length);
  const call = calls[0]!;
  if (!(call.name in toolDescriptions) || (availableActions && !availableActions.includes(call.name as RecruitmentPlannerAction))) {
    throw new RecruitmentToolProtocolError("unknown_tool", calls.length);
  }
  const args = call.args && typeof call.args === "object" && !Array.isArray(call.args)
    ? call.args as Record<string, unknown>
    : {};
  const parsed = RecruitmentActionSchema.safeParse(normalizePlannerActionPayload({ action: call.name, ...args }, targetTeam));
  if (!parsed.success) {
    const safePath = (path: PropertyKey[]) => {
      if (!path.length) return "$";
      return path.map(part => typeof part === "number" || /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(part))
        ? String(part)
        : "$").join(".").slice(0, 128);
    };
    const issuePaths = [...new Set(parsed.error.issues.map(issue => safePath(issue.path)))].slice(0, 8);
    const issueCodes = [...new Set(parsed.error.issues.map(issue => {
      const maximum = "maximum" in issue && typeof issue.maximum === "number" ? `:max=${issue.maximum}` : "";
      return `${safePath(issue.path)}:${issue.code}${maximum}`;
    }))]
      .slice(0, 8).map(issue => issue.slice(0, 160));
    throw new RecruitmentToolProtocolError("invalid_arguments", calls.length, issuePaths, issueCodes);
  }
  return { action: parsed.data, nativeMessage: output };
}

export function normalizePlannerActionPayload(candidate: unknown, targetTeam?: string | null): unknown {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return candidate;
  const payload = { ...(candidate as Record<string, unknown>) };
  if (targetTeam !== undefined) payload.targetTeam = targetTeam;
  const listFieldsByAction: Partial<Record<RecruitmentPlannerAction, readonly string[]>> = {
    inspect_player: ["sections"],
    inspect_candidate_group: ["playerIds", "sections"],
    search_candidates: ["positions"],
    evaluate_candidates: ["playerIds"],
  };
  for (const field of listFieldsByAction[payload.action as RecruitmentPlannerAction] ?? []) {
    if (typeof payload[field] === "string") payload[field] = [payload[field]];
  }
  if (payload.action === "finish" && Array.isArray(payload.limitationKeys)) {
    payload.limitationKeys = payload.limitationKeys.map((key) => (
      typeof key === "string" && !FinishLimitationKeySchema.safeParse(key).success
        ? "other"
        : key
    ));
  }
  if (payload.action === "search_player_reports") return { ...payload, playerNames: [] };
  if (payload.action === "search_candidates" && (payload.positions === null || Array.isArray(payload.positions) && payload.positions.length === 0)) {
    const normalized = { ...payload };
    delete normalized.positions;
    return normalized;
  }
  return payload;
}

export function messageForRecruitmentAction(action: ParsedRecruitmentAction, id: string): AIMessage {
  const { action: name, ...args } = action;
  return new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
}

export function recruitmentDataToolNames(): ToolActionName[] {
  return Object.keys(toolBudgets) as ToolActionName[];
}
