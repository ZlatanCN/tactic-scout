import { AIMessage } from "@langchain/core/messages";
import { getStore } from "@langchain/langgraph";
import type { BaseStore, GraphNode } from "@langchain/langgraph";

import {
  deletePlayerMemoryTarget,
  findPlayerMemoryForgetOptions,
  listPlayerMemories,
} from "../player-memory.js";
import type {
  PlayerMemoryDeleteResult,
  PlayerMemoryForgetQuery,
  PlayerMemoryListResult,
  PlayerMemoryListingRecord,
} from "../player-memory.js";
import type {
  AgentState,
  AgentStateType,
  PlayerMemoryManagementRequest,
} from "../state.js";

type ResolvedMemoryForgetTarget = Exclude<
  PlayerMemoryManagementRequest["selectedTarget"],
  null
>;

const validationLabel = (status: string): string => {
  if (status === "current") {
    return "当前资料校验通过";
  }

  if (status === "conflicting") {
    return "存在冲突，需要重新确认";
  }

  if (status === "needs_confirmation") {
    return "资料已变化，需要重新确认";
  }

  return "当前无法校验";
};

const listRecordLabel = (record: PlayerMemoryListingRecord): string => {
  if (record.kind === "player_identity") {
    const sources = record.sourceRecords
      .map(({ provider, sourceId }) => `${provider} ${sourceId}`)
      .join("；");

    const canonical = record.identityVerified
      ? `；Reep ${record.canonicalIdentityId}`
      : "；未核实 Reep 身份";

    return `称呼“${record.mention}” → ${record.displayName}（${sources}${canonical}；${validationLabel(record.validationStatus)}；确认于 ${record.confirmedAt}；thread ${record.originThreadId}；确认编号 ${record.confirmationId}）`;
  }

  return `阵容映射 API-Football #${record.apiFootballPlayerId}（${record.rosterPlayerName}） → FM ${record.fmId}（${record.fmPlayerName}；${validationLabel(record.validationStatus)}；确认于 ${record.confirmedAt}；thread ${record.originThreadId}；确认编号 ${record.confirmationId}）`;
};

const listMessage = (
  result: Extract<PlayerMemoryListResult, { status: "ready" }>
) => {
  if (result.records.length === 0) {
    return "当前没有已记住的球员称呼或阵容映射。";
  }

  const entries = result.records
    .map((record, index) => `${index + 1}. ${listRecordLabel(record)}`)
    .join("\n");

  const truncationNotice = result.truncated
    ? "\n列表已截断；当前显示的记录可能不完整。"
    : "";

  return `已记住的球员身份：\n${entries}${truncationNotice}`;
};

const targetQuery = (
  request: PlayerMemoryManagementRequest
): PlayerMemoryForgetQuery => {
  const { selectedTarget } = request;

  if (selectedTarget?.kind === "player_identity") {
    return {
      apiFootballPlayerId: null,
      fmId: null,
      targetKind: "player_identity",
      targetMention: selectedTarget.mention,
    };
  }

  if (selectedTarget?.kind === "roster_identity") {
    return {
      apiFootballPlayerId: selectedTarget.apiFootballPlayerId,
      fmId: selectedTarget.fmId,
      targetKind: "roster_identity",
      targetMention: selectedTarget.mention,
    };
  }

  return {
    apiFootballPlayerId: request.apiFootballPlayerId,
    fmId: request.fmId,
    targetKind: request.targetKind,
    targetMention: request.targetMention,
  };
};

const targetRequiredMessage = (request: PlayerMemoryManagementRequest) =>
  request.targetKind === "roster_identity"
    ? "请给出要忘记的阵容映射名称，或同时提供 API-Football 球员 ID 和 FM ID。"
    : "请给出要忘记的球员称呼。";

const deleteMessage = (
  result: PlayerMemoryDeleteResult,
  label: string
): string => {
  if (result.status === "forgotten") {
    return `已忘记：${label}。`;
  }

  if (result.status === "not_found") {
    return `没有找到“${label}”对应的记忆，没有删除任何记录。`;
  }

  if (result.status === "partial_failure") {
    return `删除“${label}”时部分失败：已删除 ${result.deletedCount} 条，${result.failedCount} 条未删除。`;
  }

  return `无法删除“${label}”对应的记忆；没有报告删除成功。`;
};

const completedUpdate = (
  status: Extract<
    AgentStateType["outcome"],
    { kind: "player_memory_management" }
  >["status"],
  resultJson: string | null,
  message: string
) => ({
  messages: [new AIMessage(message)],
  outcome: {
    kind: "player_memory_management" as const,
    resultJson,
    status,
  },
  playerMemoryManagementRequest: null,
});

const failedUpdate = (
  status: "failed" | "not_found",
  message: string,
  resultJson: string | null = null
) => completedUpdate(status, resultJson, message);

const sameForgetTarget = (
  left: ResolvedMemoryForgetTarget,
  right: ResolvedMemoryForgetTarget
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "player_identity" && right.kind === "player_identity") {
    return left.mention === right.mention;
  }

  return (
    left.kind === "roster_identity" &&
    right.kind === "roster_identity" &&
    left.apiFootballPlayerId === right.apiFootballPlayerId &&
    left.fmId === right.fmId
  );
};

const selectedForgetOption = (
  options: Extract<
    Awaited<ReturnType<typeof findPlayerMemoryForgetOptions>>,
    { status: "ready" }
  >["options"],
  request: PlayerMemoryManagementRequest
) => {
  if (request.selectedTarget === null) {
    return options.length === 1 ? (options[0] ?? null) : null;
  }

  const { selectedTarget } = request;

  return (
    options.find((option) => sameForgetTarget(option.target, selectedTarget)) ??
    null
  );
};

const createManagePlayerMemoryNode =
  (configuredStore: BaseStore | null): GraphNode<typeof AgentState> =>
  async (state, runtime) => {
    const request = state.playerMemoryManagementRequest;

    if (!request) {
      return {};
    }

    const store = configuredStore ?? getStore(runtime);

    if (store === undefined) {
      return failedUpdate(
        "failed",
        "无法访问球员身份记忆，因此没有完成这次操作。"
      );
    }

    if (request.action === "list") {
      const result = await listPlayerMemories(store);

      return result.status === "ready"
        ? completedUpdate("listed", JSON.stringify(result), listMessage(result))
        : failedUpdate("failed", "无法读取球员身份记忆，列表没有生成。");
    }

    const query = targetQuery(request);

    if (
      query.targetMention === null &&
      query.apiFootballPlayerId === null &&
      query.fmId === null
    ) {
      return failedUpdate(
        "failed",
        targetRequiredMessage(request),
        JSON.stringify({ reason: "target_required" })
      );
    }

    const resolution = await findPlayerMemoryForgetOptions(store, query);

    if (resolution.status !== "ready") {
      return failedUpdate(
        "failed",
        "无法读取球员身份记忆，因此没有删除任何记录。"
      );
    }

    if (resolution.options.length === 0) {
      return failedUpdate(
        "not_found",
        "没有找到对应的球员记忆，没有删除任何记录。",
        JSON.stringify({ target: query })
      );
    }

    if (resolution.options.length > 1 && request.selectedTarget === null) {
      const { options } = resolution;

      const numberedOptions = options
        .map((option, index) => `${index + 1}. ${option.label}`)
        .join("；");

      return {
        pendingClarification: {
          answer: null,
          kind: "player_memory_management" as const,
          options,
          question: `“${query.targetMention ?? "这个目标"}”对应多条记忆，请选择要忘记的记录：${numberedOptions}。也可以回复“取消”。`,
        },
      };
    }

    const [option] = resolution.options;
    const selected = selectedForgetOption(resolution.options, request);

    if (selected === null || option === undefined) {
      return failedUpdate(
        "failed",
        "无法确认要删除的记忆目标，没有删除任何记录。"
      );
    }

    const result = await deletePlayerMemoryTarget(store, selected.target);

    return completedUpdate(
      result.status,
      JSON.stringify({
        deletion: result,
        label: selected.label,
      }),
      deleteMessage(result, selected.label)
    );
  };

export { createManagePlayerMemoryNode };
