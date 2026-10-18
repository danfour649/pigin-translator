const SAFE_ERROR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Error class and HTTP status only. Message, cause, and body are omitted. */
export function safeErrorStatus(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";

  const record = error as {
    name?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  const name =
    typeof record.name === "string" && SAFE_ERROR_NAME.test(record.name)
      ? record.name
      : "Error";
  const statusCode = record.statusCode ?? record.status;
  const status =
    typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
      ? statusCode
      : undefined;

  return status === undefined ? name : `${name} ${status}`;
}

export function translationFailureLog(
  provider: string,
  modelId: string,
  error: unknown,
): string {
  return `Translation with ${provider} (${modelId}) failed (${safeErrorStatus(error)})`;
}
