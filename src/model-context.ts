import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod/v4";

import type { ModelRequestBudget, ModelRuntime } from "./model-requests.js";

const ModelContextProfileBaseSchema = z.object({
  contextWindowTokens: z.number().int().positive().optional(),
  countingMarginTokens: z.number().int().positive().optional(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive(),
  softTriggerFraction: z.number().gt(0).lt(1).default(0.8),
  targetFraction: z.number().gt(0).lt(1).default(0.6),
});

const ModelContextProfileSchema = ModelContextProfileBaseSchema.superRefine(
  (profile, context) => {
    if (
      profile.maxInputTokens === undefined &&
      profile.contextWindowTokens === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A context window or input token limit is required.",
        path: ["contextWindowTokens"],
      });
    }

    if (profile.softTriggerFraction <= profile.targetFraction) {
      context.addIssue({
        code: "custom",
        message: "The soft trigger must be greater than the compaction target.",
        path: ["softTriggerFraction"],
      });
    }
  }
);

const EnvironmentModelContextProfileSchema =
  ModelContextProfileBaseSchema.extend({
    baseURL: z.string().nullable(),
    model: z.string().trim().min(1),
  });

type ModelContextProfile = z.output<typeof ModelContextProfileSchema>;

type ModelContextProfileInput = z.input<typeof ModelContextProfileSchema>;

type ModelOutputLimitAdapter = (
  model: BaseChatModel,
  maxOutputTokens: number
) => BaseChatModel;

type ModelContextConfiguration = {
  baseURL?: string | null;
  outputLimitAdapter?: ModelOutputLimitAdapter;
  profile?: ModelContextProfileInput;
  serializedProfile?: string;
};

type ModelContextProfileResolution =
  | {
      profile: ModelContextProfile;
      source: "explicit" | "trusted_model_profile";
      status: "ready";
    }
  | {
      issue:
        | "profile_required"
        | "invalid_profile"
        | "output_limit_adapter_required";
      status: "unavailable";
    };

type ModelContextFailure =
  | "base_instructions_exceed_limit"
  | "profile_required"
  | "invalid_profile"
  | "output_limit_adapter_required"
  | "input_exceeds_limit"
  | "user_input_exceeds_limit"
  | "token_estimate_failed"
  | "schema_estimate_failed"
  | "provider_overflow"
  | "response_truncated";

type ModelContextErrorDetails = {
  contextBudgetFailure: ModelContextFailure;
  contextRequestAttemptsUsed?: number;
  contextRequestDurationMs?: number;
};

const providerContextOverflowCodes = new Set([
  "context_length_exceeded",
  "context_window_exceeded",
  "input_too_long",
  "max_context_length_exceeded",
]);

const providerContextErrorSchema = z.looseObject({
  cause: z.looseObject({ code: z.string().optional() }).optional(),
  code: z.string().nullable().optional(),
  error: z.looseObject({ code: z.string().optional() }).optional(),
});

const isProviderContextOverflow = (error: Error): boolean => {
  const details = providerContextErrorSchema.safeParse(error);

  const codes = details.success
    ? [details.data.code, details.data.error?.code, details.data.cause?.code]
    : [];

  if (
    codes.some(
      (code) =>
        code !== undefined &&
        code !== null &&
        providerContextOverflowCodes.has(code.toLowerCase())
    )
  ) {
    return true;
  }

  const message = error.message.toLowerCase();

  return [
    "context length exceeded",
    "maximum context length",
    "maximum context window",
    "too many tokens for the model",
  ].some((phrase) => message.includes(phrase));
};

const ModelContextPurposeSchema = z.enum([
  "understand_request",
  "lookup_player",
  "answer",
  "compact_context",
]);

type ModelContextPurpose = z.infer<typeof ModelContextPurposeSchema>;

type ModelContextRequest = {
  currentUserInput?: string;
  messages: BaseMessage[];
  purpose: ModelContextPurpose;
  structuredOutputSchemas?: Parameters<typeof toJsonSchema>[0][];
  tools?: StructuredToolInterface[];
};

type ModelContextAssessment = {
  compactionSuggested: boolean;
  estimatedInputTokens: number;
  hardInputLimitTokens: number;
  maxOutputTokens: number;
  purpose: ModelContextRequest["purpose"];
  softTriggerTokens: number;
  tokenCountingMethod: "langchain_model_tokenizer";
  targetTokens: number;
};

type ModelContextAssessmentResult = {
  assessment: ModelContextAssessment;
  failure: ModelContextFailure | null;
};

type PreparedModelRequest = {
  assessment: ModelContextAssessment;
  model: BaseChatModel;
};

type ModelCall<Value> = (
  model: BaseChatModel,
  signal?: AbortSignal
) => Promise<Value>;

const officialOpenAIBaseURL = "https://api.openai.com/v1";

const normalizeBaseURL = (value: string | null): string | null => {
  if (value === null || value.trim().length === 0) {
    return null;
  }

  let normalized: string;

  try {
    normalized = new URL(value).toString();
  } catch {
    normalized = value.trim();
  }

  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
};

const ModelContextErrorDetailsSchema = z.looseObject({
  contextBudgetFailure: z.enum([
    "base_instructions_exceed_limit",
    "profile_required",
    "invalid_profile",
    "output_limit_adapter_required",
    "input_exceeds_limit",
    "user_input_exceeds_limit",
    "token_estimate_failed",
    "schema_estimate_failed",
    "provider_overflow",
    "response_truncated",
  ]),
  contextRequestAttemptsUsed: z.number().int().nonnegative().optional(),
  contextRequestDurationMs: z.number().int().nonnegative().optional(),
});

const modelContextErrorDetailsFor = (error: Error) => {
  const parsed = ModelContextErrorDetailsSchema.safeParse(error);

  return parsed.success ? parsed.data : null;
};

const modelContextFailure = (error: Error): ModelContextFailure | null => {
  const details = modelContextErrorDetailsFor(error);

  return details?.contextBudgetFailure ?? null;
};

const modelContextRequestDurationMs = (error: Error): number | null => {
  const details = modelContextErrorDetailsFor(error);

  return details?.contextRequestDurationMs ?? null;
};

const modelContextRequestAttemptsUsed = (error: Error): number | null => {
  const details = modelContextErrorDetailsFor(error);

  return details?.contextRequestAttemptsUsed ?? null;
};

const modelContextFailureMessage = (issue: ModelContextFailure): string => {
  if (issue === "profile_required" || issue === "invalid_profile") {
    return "The configured model context profile is missing or invalid.";
  }

  if (issue === "output_limit_adapter_required") {
    return "This model does not have an output token limit adapter.";
  }

  if (issue === "input_exceeds_limit") {
    return "The complete model input exceeds the configured input budget.";
  }

  if (issue === "base_instructions_exceed_limit") {
    return "The system instructions and schemas exceed the configured input budget.";
  }

  if (issue === "user_input_exceeds_limit") {
    return "The current user input exceeds the configured model context budget.";
  }

  if (issue === "response_truncated") {
    return "The model response reached its output limit before completion.";
  }

  if (issue === "provider_overflow") {
    return "The model provider rejected the input for exceeding its context window.";
  }

  return "The complete model input could not be counted safely.";
};

const modelContextErrorDetails = (
  issue: ModelContextFailure,
  requestDurationMs?: number,
  requestAttemptsUsed?: number
): ModelContextErrorDetails => {
  const details: ModelContextErrorDetails = {
    contextBudgetFailure: issue,
  };

  if (requestDurationMs !== undefined) {
    details.contextRequestDurationMs = requestDurationMs;
  }

  if (requestAttemptsUsed !== undefined) {
    details.contextRequestAttemptsUsed = requestAttemptsUsed;
  }

  return details;
};

const createModelContextError = (
  issue: ModelContextFailure,
  requestDurationMs?: number,
  requestAttemptsUsed?: number
): Error =>
  Object.assign(
    new Error(modelContextFailureMessage(issue)),
    modelContextErrorDetails(issue, requestDurationMs, requestAttemptsUsed)
  );

const effectiveBaseURL = (
  model: BaseChatModel,
  configuration: ModelContextConfiguration
): string | null => {
  let source: string | null;

  if (configuration.baseURL !== undefined) {
    source = configuration.baseURL;
  } else if (model instanceof ChatOpenAI) {
    source = model.clientConfig.baseURL ?? null;
  } else {
    source = process.env.OPENAI_BASE_URL?.trim() ?? null;
  }

  const normalized = normalizeBaseURL(source);

  return normalized === normalizeBaseURL(officialOpenAIBaseURL)
    ? null
    : normalized;
};

const validateModelContextProfile = (
  value: ModelContextProfileInput | ModelContextProfile,
  source: Extract<ModelContextProfileResolution, { status: "ready" }>["source"]
): ModelContextProfileResolution => {
  const parsed = ModelContextProfileSchema.safeParse(value);

  return parsed.success
    ? { profile: parsed.data, source, status: "ready" }
    : { issue: "invalid_profile", status: "unavailable" };
};

const environmentModelContextProfile = (
  model: BaseChatModel,
  baseURL: string | null,
  serializedProfile: string | undefined
): ModelContextProfileResolution => {
  if (serializedProfile !== undefined && serializedProfile.trim().length > 0) {
    let rawProfile: unknown;

    try {
      rawProfile = JSON.parse(serializedProfile);
    } catch {
      return { issue: "invalid_profile", status: "unavailable" };
    }

    const configured =
      EnvironmentModelContextProfileSchema.safeParse(rawProfile);

    if (!configured.success) {
      return { issue: "invalid_profile", status: "unavailable" };
    }

    const modelName =
      model instanceof ChatOpenAI
        ? model.model
        : (process.env.OPENAI_MODEL?.trim() ?? model._llmType());

    const normalizedBaseURL = normalizeBaseURL(baseURL);
    const normalizedProfileBaseURL = normalizeBaseURL(configured.data.baseURL);

    if (
      configured.data.model !== modelName ||
      normalizedProfileBaseURL !== normalizedBaseURL
    ) {
      return { issue: "invalid_profile", status: "unavailable" };
    }

    return validateModelContextProfile(configured.data, "explicit");
  }

  if (baseURL === null && model instanceof ChatOpenAI) {
    const trustedProfile = z
      .object({
        maxInputTokens: z.number().int().positive(),
        maxOutputTokens: z.number().int().positive(),
      })
      .safeParse(model.profile);

    if (trustedProfile.success) {
      return validateModelContextProfile(
        trustedProfile.data,
        "trusted_model_profile"
      );
    }
  }

  return { issue: "profile_required", status: "unavailable" };
};

const resolveModelContextProfile = (
  model: BaseChatModel,
  configuration: ModelContextConfiguration = {}
): ModelContextProfileResolution => {
  if (configuration.profile !== undefined) {
    return validateModelContextProfile(configuration.profile, "explicit");
  }

  const serializedProfile =
    configuration.serializedProfile ??
    process.env.TACTISCOUT_MODEL_CONTEXT_PROFILE;

  return environmentModelContextProfile(
    model,
    effectiveBaseURL(model, configuration),
    serializedProfile
  );
};

const serializedMessage = (message: BaseMessage) => {
  const serialized = {
    additional_kwargs: message.additional_kwargs,
    content: message.content,
    id: message.id,
    name: message.name,
    role: message.type,
  };

  if (message instanceof AIMessage) {
    return {
      ...serialized,
      invalid_tool_calls: message.invalid_tool_calls,
      tool_calls: message.tool_calls,
    };
  }

  if (message instanceof ToolMessage) {
    return {
      ...serialized,
      status: message.status,
      tool_call_id: message.tool_call_id,
    };
  }

  return serialized;
};

const serializedSchemas = (request: ModelContextRequest) => ({
  structured_output: request.structuredOutputSchemas?.map((schema) =>
    toJsonSchema(schema)
  ),
  tools: request.tools?.map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: toJsonSchema(tool.schema),
  })),
});

const assessModelInput = async (
  model: BaseChatModel,
  resolution: ModelContextProfileResolution,
  request: ModelContextRequest
): Promise<ModelContextAssessmentResult> => {
  if (resolution.status !== "ready") {
    throw createModelContextError(resolution.issue);
  }

  let serialized: string;

  try {
    serialized = JSON.stringify({
      messages: request.messages.map(serializedMessage),
      schemas: serializedSchemas(request),
    });
  } catch {
    throw createModelContextError("schema_estimate_failed");
  }

  let modelTokenEstimate: number;

  try {
    modelTokenEstimate = await model.getNumTokens(serialized);
  } catch {
    throw createModelContextError("token_estimate_failed");
  }

  if (!Number.isSafeInteger(modelTokenEstimate) || modelTokenEstimate < 0) {
    throw createModelContextError("token_estimate_failed");
  }

  const { profile } = resolution;

  const sharedWindowInputLimit =
    profile.contextWindowTokens === undefined
      ? Number.POSITIVE_INFINITY
      : profile.contextWindowTokens - profile.maxOutputTokens;

  const inputLimitBeforeMargin = Math.min(
    profile.maxInputTokens ?? Number.POSITIVE_INFINITY,
    sharedWindowInputLimit
  );

  const countingMarginTokens =
    profile.countingMarginTokens ??
    Math.max(64, Math.ceil(inputLimitBeforeMargin * 0.1));

  const hardInputLimitTokens = inputLimitBeforeMargin - countingMarginTokens;

  if (hardInputLimitTokens <= 0) {
    throw createModelContextError("invalid_profile");
  }

  const serializedRequestReserve = (messageCount: number): number =>
    32 +
    messageCount * 4 +
    (request.tools?.length ?? 0) * 16 +
    (request.structuredOutputSchemas?.length ?? 0) * 16;

  const estimatedInputTokens =
    modelTokenEstimate + serializedRequestReserve(request.messages.length);

  const softTriggerTokens = Math.floor(
    hardInputLimitTokens * profile.softTriggerFraction
  );

  const targetTokens = Math.floor(
    hardInputLimitTokens * profile.targetFraction
  );

  let failure: ModelContextFailure | null = null;

  if (estimatedInputTokens > hardInputLimitTokens) {
    const systemMessages = request.messages.filter(
      ({ type }) => type === "system"
    );

    const serializedBaseInstructions = JSON.stringify({
      messages: systemMessages.map(serializedMessage),
      schemas: serializedSchemas(request),
    });

    let baseInstructionTokens: number;

    try {
      baseInstructionTokens = await model.getNumTokens(
        serializedBaseInstructions
      );
    } catch {
      throw createModelContextError("token_estimate_failed");
    }

    const baseInstructionEstimate =
      baseInstructionTokens + serializedRequestReserve(systemMessages.length);

    if (baseInstructionEstimate > hardInputLimitTokens) {
      failure = "base_instructions_exceed_limit";
    } else if (request.currentUserInput === undefined) {
      failure = "input_exceeds_limit";
    } else {
      let currentUserInputTokens: number;

      try {
        currentUserInputTokens = await model.getNumTokens(
          request.currentUserInput
        );
      } catch {
        throw createModelContextError("token_estimate_failed");
      }

      failure =
        baseInstructionEstimate + currentUserInputTokens + 4 >
        hardInputLimitTokens
          ? "user_input_exceeds_limit"
          : "input_exceeds_limit";
    }
  }

  return {
    assessment: {
      compactionSuggested: estimatedInputTokens > softTriggerTokens,
      estimatedInputTokens,
      hardInputLimitTokens,
      maxOutputTokens: profile.maxOutputTokens,
      purpose: request.purpose,
      softTriggerTokens,
      targetTokens,
      tokenCountingMethod: "langchain_model_tokenizer",
    },
    failure,
  };
};

const defaultModelOutputLimitAdapter: ModelOutputLimitAdapter = (
  model,
  maxOutputTokens
) => {
  if (!(model instanceof ChatOpenAI)) {
    throw createModelContextError("output_limit_adapter_required");
  }

  const configuredOutputLimit =
    Number.isSafeInteger(model.maxTokens) &&
    model.maxTokens !== undefined &&
    model.maxTokens > 0
      ? Math.min(model.maxTokens, maxOutputTokens)
      : maxOutputTokens;

  return new ChatOpenAI({
    apiKey: model.apiKey,
    audio: model.audio,
    configuration: model.clientConfig,
    frequencyPenalty: model.frequencyPenalty,
    logitBias: model.logitBias,
    logprobs: model.logprobs,
    maxRetries: 0,
    maxTokens: configuredOutputLimit,
    modalities: model.modalities,
    model: model.model,
    modelKwargs: model.modelKwargs,
    n: model.n,
    presencePenalty: model.presencePenalty,
    promptCacheKey: model.promptCacheKey,
    promptCacheOptions: model.promptCacheOptions,
    promptCacheRetention: model.promptCacheRetention,
    reasoning: model.reasoning,
    service_tier: model.service_tier,
    stop: model.stop,
    stopSequences: model.stopSequences,
    streamUsage: model.streamUsage,
    streaming: model.streaming,
    temperature: model.temperature,
    timeout: model.timeout,
    topLogprobs: model.topLogprobs,
    topP: model.topP,
    useResponsesApi: model.useResponsesApi,
    user: model.user,
    verbosity: model.verbosity,
  });
};

const profileWithExistingOutputLimit = (
  model: BaseChatModel,
  resolution: ModelContextProfileResolution
): ModelContextProfileResolution => {
  if (resolution.status !== "ready" || !(model instanceof ChatOpenAI)) {
    return resolution;
  }

  const existingOutputLimit = model.maxTokens;

  if (
    existingOutputLimit === undefined ||
    !Number.isSafeInteger(existingOutputLimit) ||
    existingOutputLimit <= 0
  ) {
    return resolution;
  }

  return {
    ...resolution,
    profile: {
      ...resolution.profile,
      maxOutputTokens: Math.min(
        resolution.profile.maxOutputTokens,
        existingOutputLimit
      ),
    },
  };
};

const applyModelOutputLimit = (
  model: BaseChatModel,
  maxOutputTokens: number,
  adapter?: ModelOutputLimitAdapter
): BaseChatModel => {
  try {
    return (adapter ?? defaultModelOutputLimitAdapter)(model, maxOutputTokens);
  } catch (error) {
    if (
      error instanceof Error &&
      modelContextFailure(error) === "output_limit_adapter_required"
    ) {
      throw error;
    }

    throw createModelContextError("output_limit_adapter_required");
  }
};

const assessModelRequest = async (
  model: BaseChatModel,
  request: ModelContextRequest,
  configuration: ModelContextConfiguration = {}
): Promise<ModelContextAssessmentResult> => {
  const resolution = profileWithExistingOutputLimit(
    model,
    resolveModelContextProfile(model, configuration)
  );

  return await assessModelInput(model, resolution, request);
};

const prepareModelRequest = async (
  model: BaseChatModel,
  request: ModelContextRequest,
  configuration: ModelContextConfiguration = {}
): Promise<PreparedModelRequest> => {
  const result = await assessModelRequest(model, request, configuration);

  if (result.failure !== null) {
    throw createModelContextError(result.failure);
  }

  const { assessment } = result;

  const limitedModel = applyModelOutputLimit(
    model,
    assessment.maxOutputTokens,
    configuration.outputLimitAdapter
  );

  return { assessment, model: limitedModel };
};

const modelResponseEnvelopeSchema = z.union([
  z.instanceof(BaseMessage),
  z.looseObject({ raw: z.instanceof(BaseMessage) }),
]);

const providerUsageValuesSchema = z.looseObject({
  completionTokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  prompt_tokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
});

type ProviderTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

const providerTokenUsageFrom = (
  envelope: z.output<typeof modelResponseEnvelopeSchema>
): ProviderTokenUsage | null => {
  const message = envelope instanceof BaseMessage ? envelope : envelope.raw;

  const metadata = z
    .looseObject({ tokenUsage: z.unknown(), usage: z.unknown() })
    .partial()
    .safeParse(message.response_metadata);

  const candidates = [
    ...(message instanceof AIMessage ? [message.usage_metadata] : []),
    message.response_metadata,
    ...(metadata.success
      ? [metadata.data.tokenUsage, metadata.data.usage]
      : []),
  ];

  for (const candidate of candidates) {
    const parsed = providerUsageValuesSchema.safeParse(candidate);

    if (!parsed.success) {
      continue;
    }

    const inputTokens =
      parsed.data.input_tokens ??
      parsed.data.prompt_tokens ??
      parsed.data.promptTokens;

    const outputTokens =
      parsed.data.output_tokens ??
      parsed.data.completion_tokens ??
      parsed.data.completionTokens;

    const totalTokens = parsed.data.total_tokens ?? parsed.data.totalTokens;

    if (
      inputTokens !== undefined ||
      outputTokens !== undefined ||
      totalTokens !== undefined
    ) {
      return {
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        totalTokens: totalTokens ?? null,
      };
    }
  }

  return null;
};

const modelResponseIsTruncated = (
  response: z.output<typeof modelResponseEnvelopeSchema>
): boolean => {
  const rawMessage = response instanceof BaseMessage ? response : response.raw;

  const metadata = z
    .looseObject({
      finishReason: z.string().optional(),
      finish_reason: z.string().optional(),
      incomplete_details: z.unknown().optional(),
      status: z.string().optional(),
      stop_reason: z.string().optional(),
    })
    .safeParse(rawMessage.response_metadata);

  if (!metadata.success) {
    return false;
  }

  const finishReason =
    metadata.data.finish_reason ??
    metadata.data.finishReason ??
    metadata.data.stop_reason;

  const truncatedFinishReasons = new Set([
    "length",
    "max_tokens",
    "max_output_tokens",
    "incomplete",
  ]);

  const incompleteDetails = metadata.data.incomplete_details;

  return (
    truncatedFinishReasons.has(finishReason ?? "") ||
    metadata.data.status === "incomplete" ||
    (incompleteDetails !== undefined && incompleteDetails !== null)
  );
};

const createModelContextLog = (
  status: "ready" | "blocked",
  details: {
    compactionSuggested?: boolean;
    estimatedInputTokens?: number;
    hardInputLimitTokens?: number;
    issue?: ModelContextFailure;
    maxOutputTokens?: number;
    purpose: ModelContextRequest["purpose"];
    softTriggerTokens?: number;
    tokenCountingMethod?: ModelContextAssessment["tokenCountingMethod"];
    targetTokens?: number;
  },
  runtime?: { executionInfo?: { runId?: string; threadId?: string } }
): void => {
  try {
    console.info(
      JSON.stringify({
        ...details,
        component: "tactiscout",
        runId: runtime?.executionInfo?.runId ?? "unavailable",
        status,
        threadId: runtime?.executionInfo?.threadId ?? "unavailable",
        type: "model_context_budget",
      })
    );
  } catch {
    // Context accounting is best-effort and must not replace the model outcome.
  }
};

const createModelContextUsageLog = (
  assessment: ModelContextAssessment,
  usage: ProviderTokenUsage | null,
  runtime: ModelRuntime,
  contextIssue: "response_truncated" | null
): void => {
  try {
    console.info(
      JSON.stringify({
        component: "tactiscout",
        contextIssue,
        estimatedInputTokens: assessment.estimatedInputTokens,
        providerInputTokens: usage?.inputTokens ?? null,
        providerOutputTokens: usage?.outputTokens ?? null,
        providerTotalTokens: usage?.totalTokens ?? null,
        providerUsageStatus: usage === null ? "unavailable" : "reported",
        purpose: assessment.purpose,
        runId: runtime.executionInfo?.runId ?? "unavailable",
        threadId: runtime.executionInfo?.threadId ?? "unavailable",
        tokenCountingMethod: assessment.tokenCountingMethod,
        type: "model_context_usage",
      })
    );
  } catch {
    // Usage accounting is best-effort and must not replace the model outcome.
  }
};

const invokeWithModelContext = async <Value>(
  model: BaseChatModel,
  request: ModelContextRequest,
  configuration: ModelContextConfiguration,
  runtime: ModelRuntime,
  invoke: ModelCall<Value>,
  budget?: ModelRequestBudget,
  budgetOptions: { allowRateLimitRetry?: boolean } = {}
): Promise<Value> => {
  let prepared: PreparedModelRequest;

  try {
    prepared = await prepareModelRequest(model, request, configuration);
  } catch (error) {
    if (error instanceof Error) {
      const issue = modelContextFailure(error);

      if (issue !== null) {
        createModelContextLog(
          "blocked",
          { issue, purpose: request.purpose },
          runtime
        );
      }
    }

    throw error;
  }

  createModelContextLog(
    "ready",
    {
      compactionSuggested: prepared.assessment.compactionSuggested,
      estimatedInputTokens: prepared.assessment.estimatedInputTokens,
      hardInputLimitTokens: prepared.assessment.hardInputLimitTokens,
      maxOutputTokens: prepared.assessment.maxOutputTokens,
      purpose: prepared.assessment.purpose,
      softTriggerTokens: prepared.assessment.softTriggerTokens,
      targetTokens: prepared.assessment.targetTokens,
      tokenCountingMethod: prepared.assessment.tokenCountingMethod,
    },
    runtime
  );

  const invokePrepared = async (signal?: AbortSignal): Promise<Value> => {
    let response: Value;
    const requestStartedAt = Date.now();

    try {
      response = await invoke(prepared.model, signal);
    } catch (error) {
      if (error instanceof Error && isProviderContextOverflow(error)) {
        createModelContextLog(
          "blocked",
          {
            estimatedInputTokens: prepared.assessment.estimatedInputTokens,
            issue: "provider_overflow",
            purpose: prepared.assessment.purpose,
            tokenCountingMethod: prepared.assessment.tokenCountingMethod,
          },
          runtime
        );
        const requestDurationMs = Math.max(0, Date.now() - requestStartedAt);

        if (budget !== undefined) {
          throw error;
        }

        throw createModelContextError(
          "provider_overflow",
          requestDurationMs,
          1
        );
      }

      throw error;
    }

    const responseEnvelope = modelResponseEnvelopeSchema.safeParse(response);

    if (
      responseEnvelope.success &&
      modelResponseIsTruncated(responseEnvelope.data)
    ) {
      createModelContextUsageLog(
        prepared.assessment,
        providerTokenUsageFrom(responseEnvelope.data),
        runtime,
        "response_truncated"
      );

      throw createModelContextError(
        "response_truncated",
        Math.max(0, Date.now() - requestStartedAt),
        budget?.requestsUsed() ?? 1
      );
    }

    createModelContextUsageLog(
      prepared.assessment,
      responseEnvelope.success
        ? providerTokenUsageFrom(responseEnvelope.data)
        : null,
      runtime,
      null
    );

    return response;
  };

  return budget === undefined
    ? await invokePrepared(runtime.signal)
    : await budget.invoke(invokePrepared, budgetOptions);
};

export {
  EnvironmentModelContextProfileSchema,
  ModelContextProfileSchema,
  applyModelOutputLimit,
  assessModelRequest,
  assessModelInput,
  createModelContextError,
  createModelContextLog,
  invokeWithModelContext,
  isProviderContextOverflow,
  modelContextFailure,
  modelContextFailureMessage,
  modelContextRequestAttemptsUsed,
  modelContextRequestDurationMs,
  normalizeBaseURL,
  prepareModelRequest,
  resolveModelContextProfile,
};

export type {
  ModelContextFailure,
  ModelContextConfiguration,
  ModelContextProfile,
  ModelContextProfileInput,
  ModelContextProfileResolution,
  ModelContextAssessment,
  ModelContextAssessmentResult,
  ModelContextPurpose,
  ModelContextRequest,
  ModelOutputLimitAdapter,
};
