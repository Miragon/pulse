/** An `isError` tool result; the literal `true` lets a handler with an outputSchema return it. */
function errorResult(message: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: message }] }
}

/**
 * A throw reaches the model as `[<status or code>] <message>`: mcp-use passes the bare message,
 * and the code (`ENGINE_NOT_SELECTED`, `UNKNOWN_ENGINE`) is what tells the model the next step.
 * An HTTP-ish `status` wins over a domain `code`; without either the message stays as it is.
 */
export function withToolErrors<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult | ReturnType<typeof errorResult>> {
  return async (...args) => {
    try {
      return await handler(...args)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const { status, code } = (e ?? {}) as { status?: string | number; code?: string | number }
      const errorCode = status ?? code
      return errorResult(errorCode ? `[${errorCode}] ${message}` : message)
    }
  }
}
