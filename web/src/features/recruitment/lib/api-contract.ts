export class ApiContractError extends Error {
  constructor(subject: string, cause: unknown) {
    super(`服务端返回的数据格式不符合当前${subject}契约。`, { cause });
    this.name = "ApiContractError";
  }
}

export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export class ApiStreamError extends TypeError {
  constructor(
    message: string,
    readonly kind: "interrupted" | "missing_body",
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ApiStreamError";
  }
}

export class ApiServiceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("本地球探服务没有正常响应。", { cause });
    this.name = "ApiServiceUnavailableError";
  }
}

export async function readApiError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") return body.error;
  return `Request failed (${response.status})`;
}

export async function readApiResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new ApiHttpError(response.status, await readApiError(response));
  try {
    return await response.json() as unknown;
  } catch (error) {
    throw new ApiContractError("JSON 响应", error);
  }
}

export function parseApiContract<T>(
  schema: { parse: (data: unknown) => T },
  value: unknown,
  subject = "招募",
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new ApiContractError(subject, error);
  }
}
