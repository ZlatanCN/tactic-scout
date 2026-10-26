import { z } from "zod/v4";

const toolCallIdentitySchema = z.object({ id: z.string().min(1) });

type ToolCallIdentity = { id?: string };

const lookupToolCallId = (call: ToolCallIdentity): string =>
  toolCallIdentitySchema.parse(call).id;

export { lookupToolCallId };
