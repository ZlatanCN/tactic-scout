import { AIMessage } from "@langchain/core/messages";
import { getStore } from "@langchain/langgraph";
import type { BaseStore, GraphNode } from "@langchain/langgraph";
import { z } from "zod/v4";

import {
  clearPlayerMemoryRecords,
  correctPlayerMemoryAlias,
  deletePlayerMemoryTarget,
  findPlayerMemoryForgetOptions,
  listPlayerMemories,
  preparePlayerMemoryClear,
} from "../player-memory.js";
import type {
  PlayerMemoryClearResult,
  PlayerMemoryDeleteResult,
  PlayerMemoryCorrectionResult,
  PlayerMemoryForgetQuery,
  PlayerMemoryListResult,
  PlayerMemoryListingRecord,
} from "../player-memory.js";
import type {
  AgentState,
  AgentStateType,
  PlayerMemoryManagementRequest,
  ReferenceCandidate,
} from "../state.js";

type ResolvedMemoryForgetTarget = Exclude<
  PlayerMemoryManagementRequest["selectedTarget"],
  null
>;

type PlayerMemoryForgetOption = Extract<
  Awaited<ReturnType<typeof findPlayerMemoryForgetOptions>>,
  { status: "ready" }
>["options"][number];

type CorrectionAliasResolution =
  | { alias: string; status: "ready" }
  | { options: PlayerMemoryForgetOption[]; status: "ambiguous" }
  | { status: "failed" }
  | { status: "not_found" };

type CorrectionReplacementResolution =
  | { candidate: ReferenceCandidate; status: "ready" }
  | { status: "failed" }
  | { status: "waiting" };

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

const correctionMessage = (
  result: PlayerMemoryCorrectionResult,
  alias: string,
  replacement: string
): string => {
  if (result.status === "corrected") {
    return `已将已记住的称呼“${alias}”纠正为“${replacement}”。`;
  }

  if (result.status === "not_found") {
    return `没有找到已记住的称呼“${alias}”，没有修改任何记忆。`;
  }

  if (result.status === "partial_failure") {
    return `纠正“${alias}”时部分完成：新身份已保存，但 ${result.failedCount} 条旧绑定未能移除，旧身份仍可能被使用。`;
  }

  return `无法完成对“${alias}”的纠正；没有报告旧绑定已被替换。`;
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

const clearMessage = (result: PlayerMemoryClearResult): string => {
  if (result.status === "cleared") {
    return `已清空 ${result.deletedCount} 条球员身份记忆（称呼/来源组 ${result.aliasCount} 条，阵容映射 ${result.rosterMappingCount} 条）。`;
  }

  if (result.status === "partial_failure") {
    return `清空只完成一部分：已删除 ${result.deletedCount} 条，${result.remainingCount} 条仍保留。`;
  }

  return `清空失败：${result.remainingCount} 条已批准的记忆仍保留。`;
};

const clearPlayerMemoryRequest = async (
  store: BaseStore,
  request: PlayerMemoryManagementRequest
) => {
  if (request.clearAllApproved) {
    const result = await clearPlayerMemoryRecords(
      store,
      request.clearAllConfirmationIds
    );

    return completedUpdate(
      result.status,
      JSON.stringify(result),
      clearMessage(result)
    );
  }

  const scope = await preparePlayerMemoryClear(store);

  if (scope.status !== "ready") {
    return failedUpdate(
      "failed",
      "无法读取当前球员身份记忆，清空范围不可用，没有删除任何记录。"
    );
  }

  const totalCount = scope.aliasCount + scope.rosterMappingCount;

  if (totalCount === 0) {
    const result: PlayerMemoryClearResult = {
      aliasCount: 0,
      deletedCount: 0,
      rosterMappingCount: 0,
      status: "cleared",
    };

    return completedUpdate(
      "cleared",
      JSON.stringify(result),
      "当前没有可清空的球员身份记忆。"
    );
  }

  return {
    pendingClarification: {
      answer: null,
      clearAllConfirmationIds: scope.confirmationIds,
      kind: "player_memory_management" as const,
      options: [],
      question: `将清空当前本地用户共享记忆：球员称呼/来源组 ${scope.aliasCount} 条，阵容映射 ${scope.rosterMappingCount} 条，共 ${totalCount} 条。不会删除对话线程、checkpoint、源数据或共享 Reep 身份库。请回复“确认”执行，或回复“取消”。`,
    },
  };
};

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

const resolveCorrectionAlias = async (
  store: BaseStore,
  request: PlayerMemoryManagementRequest
): Promise<CorrectionAliasResolution> => {
  if (
    request.targetMention === null ||
    request.selectedTarget?.kind === "roster_identity"
  ) {
    return { status: "failed" };
  }

  const selectedAlias =
    request.selectedTarget?.kind === "player_identity"
      ? request.selectedTarget.mention
      : null;

  const resolution = await findPlayerMemoryForgetOptions(store, {
    apiFootballPlayerId: null,
    fmId: null,
    targetKind: selectedAlias === null ? null : "player_identity",
    targetMention: selectedAlias ?? request.targetMention,
  });

  if (resolution.status !== "ready") {
    return { status: "failed" };
  }

  const aliases = resolution.options.filter(
    (option) => option.target.kind === "player_identity"
  );

  if (aliases.length === 0) {
    return { status: "not_found" };
  }

  if (selectedAlias !== null) {
    const selected = aliases.find(
      (option) =>
        option.target.kind === "player_identity" &&
        option.target.mention === selectedAlias
    );

    return selected?.target.kind === "player_identity"
      ? { alias: selected.target.mention, status: "ready" }
      : { status: "failed" };
  }

  if (aliases.length > 1) {
    return { options: aliases, status: "ambiguous" };
  }

  const [alias] = aliases;

  return alias?.target.kind === "player_identity"
    ? { alias: alias.target.mention, status: "ready" }
    : { status: "failed" };
};

const replacementCandidateForCorrection = (
  state: AgentStateType,
  replacementMention: string
): CorrectionReplacementResolution => {
  if (state.request.kind !== "player_lookup") {
    return { status: "failed" };
  }

  const [replacementPlayer] = state.request.players;

  if (replacementPlayer?.mention !== replacementMention) {
    return { status: "failed" };
  }

  const { resolution } = replacementPlayer;

  if (resolution === null && replacementPlayer.attempts === 0) {
    return { status: "waiting" };
  }

  if (resolution?.status !== "resolved") {
    return { status: "failed" };
  }

  const candidate = resolution.candidates.find(
    ({ candidateId }) => candidateId === resolution.selectedCandidateId
  );

  return candidate === undefined
    ? { status: "failed" }
    : { candidate, status: "ready" };
};

const correctPlayerMemoryRequest = async (
  store: BaseStore,
  state: AgentStateType,
  request: PlayerMemoryManagementRequest,
  runtime: Parameters<GraphNode<typeof AgentState>>[1]
) => {
  const replacement = request.replacementMention;

  if (request.targetMention === null || replacement === null) {
    return failedUpdate(
      "failed",
      "请明确写出要纠正的已记住称呼和替换球员名称；当前记忆没有修改。"
    );
  }

  const aliasResolution = await resolveCorrectionAlias(store, request);

  if (aliasResolution.status === "failed") {
    return failedUpdate(
      "failed",
      "无法读取或确认旧称呼的记忆，因此没有开始纠正。"
    );
  }

  if (aliasResolution.status === "not_found") {
    return failedUpdate(
      "not_found",
      `没有找到已记住的称呼“${request.targetMention}”，没有修改任何记忆。`,
      JSON.stringify({ alias: request.targetMention })
    );
  }

  if (aliasResolution.status === "ambiguous") {
    const numberedOptions = aliasResolution.options
      .map((option, index) => `${index + 1}. ${option.label}`)
      .join("；");

    return {
      pendingClarification: {
        answer: null,
        clearAllConfirmationIds: [],
        kind: "player_memory_management" as const,
        options: aliasResolution.options,
        question: `“${request.targetMention}”匹配到多个已记住的称呼，请选择要纠正的那一个：${numberedOptions}。也可以回复“取消”。`,
      },
    };
  }

  const replacementResolution = replacementCandidateForCorrection(
    state,
    replacement
  );

  if (replacementResolution.status === "waiting") {
    return {};
  }

  if (replacementResolution.status === "failed") {
    return failedUpdate("failed", "无法确认替换球员身份，旧称呼记忆保持不变。");
  }

  const { alias } = aliasResolution;
  const { candidate } = replacementResolution;

  const threadId = z.string().safeParse(runtime.configurable?.thread_id);

  if (!threadId.success) {
    return failedUpdate(
      "failed",
      `无法确定纠正记录的来源 thread，旧称呼记忆保持不变。`
    );
  }

  const result = await correctPlayerMemoryAlias(store, {
    candidate,
    mention: alias,
    originThreadId: threadId.data,
    playerIndex: 0,
    processedMessageId: state.request.processedMessageId,
  });

  return completedUpdate(
    result.status,
    JSON.stringify({ alias, correction: result, replacement: candidate.name }),
    correctionMessage(result, alias, candidate.name)
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

    if (request.action === "correct") {
      return await correctPlayerMemoryRequest(store, state, request, runtime);
    }

    if (request.action === "clear") {
      return await clearPlayerMemoryRequest(store, request);
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
          clearAllConfirmationIds: [],
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
