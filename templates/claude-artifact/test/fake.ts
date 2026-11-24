import type { CallOptions, Connector, ToolResult } from "../src/engine/connector.ts"
import type { ToolName } from "../src/engine/tools.ts"

export interface FakeCall {
  name: ToolName
  args: Record<string, unknown>
  options: CallOptions | undefined
}

/**
 * A connector over `answer`: its value is the call's `structuredContent`, a `ToolResult` it returns
 * as it is (`{ isError: true, … }`), a throw a failed call. It records every call.
 */
export function fakeConnector(
  answer: (name: ToolName, args: Record<string, unknown>) => unknown,
): Connector & { calls: FakeCall[] } {
  const calls: FakeCall[] = []
  return {
    calls,
    async callTool(name, args, options) {
      calls.push({ name, args, options })
      const value = await answer(name, args)
      if (value !== null && typeof value === "object" && "isError" in value) {
        return value as ToolResult
      }
      return { structuredContent: value }
    },
  }
}
