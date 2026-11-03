/** No React, no mcp-use: the server tests and the view runtime decode tool results the same way. */

export interface ToolResult {
  content?: ReadonlyArray<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

function firstText(result: ToolResult | null | undefined): string | undefined {
  return result?.content?.find((block) => typeof block.text === "string")?.text
}

/**
 * A tool's own `isError` answer (a validation error, an engine 404), not a transport failure.
 * The message is the tool's text, so `describeError` reads it like any other failure.
 */
export class ToolResultError extends Error {
  readonly result: ToolResult

  constructor(result: ToolResult) {
    super(firstText(result) ?? "Tool call failed")
    this.name = "ToolResultError"
    this.result = result
  }
}

/**
 * `isError` throws {@link ToolResultError}; then `structuredContent` (when not null); then the
 * first text block, JSON-decoded or as the text itself; else the result as it is. A `*_data`
 * feed answers in its text block only, a show tool in `structuredContent`.
 */
export function decodeToolResult<T>(result: ToolResult): T {
  if (result?.isError) throw new ToolResultError(result)
  if (result?.structuredContent != null) return result.structuredContent as T
  const text = firstText(result)
  if (text === undefined) return result as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}
