import type { ToolCall } from "@langchain/core/messages";
import { z } from "zod/v4";

const jsonValueSchema = z.json();

const toolCallIdentitySchema = z.object({ id: z.string().min(1) });

type ToolCallIdentity = { id?: string };

const lookupToolCallId = (call: ToolCallIdentity): string =>
  toolCallIdentitySchema.parse(call).id;

const lookupToolCallExecutionKey = (
  call: Pick<ToolCall, "args" | "id" | "name">
): string => {
  const args = jsonValueSchema.safeParse(call.args);

  return args.success
    ? JSON.stringify([call.name, args.data])
    : `invalid:${lookupToolCallId(call)}`;
};

export { lookupToolCallExecutionKey, lookupToolCallId };
