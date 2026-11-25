import {
  RUNTIME_CODES,
  type ClaudeRuntime,
  type McpAnswer,
  type McpCapability,
} from "../src/engine/claude-connector.ts"
import type { ToolResult } from "../src/engine/connector.ts"
import { callKey, resultText } from "../src/engine/engine.ts"
import { isPageTool } from "../src/engine/tools.ts"
import { CONNECTOR_NAME } from "../src/page.config.ts"

/**
 * A recording of one dashboard load (`pnpm record`): every call the reads made, in one run (ids are
 * per engine boot, so recordings are never joined), each with its answer as the server sent it,
 * kept small (`structuredContent`, or the text of a text-only or error result).
 */
export interface Fixture {
  /** When the calls ran: the engine's clock on replay, so relative times read as they did. */
  asOf: string
  /** The IANA time zone the days were counted in: the page's on replay, so the calls match. */
  timeZone: string
  process: string
  engine: string
  calls: RecordedCall[]
}

export interface RecordedCall {
  tool: string
  arguments: Record<string, unknown>
  result: ToolResult
}

export interface MockOptions {
  /**
   * What fails, to see a failure (`?fail=`, comma-separated): a tool's name fails that tool with
   * an engine error (`engine_process_stats`), a runtime code refuses every call with it
   * (`needs_reauth`), a tool and a code joined by a colon refuse that tool with it
   * (`engine_process_stats:server_unavailable`).
   */
  fail?: readonly string[]
  /** How long each answer takes, in ms, to see the skeletons (`?delay=800`). */
  delayMs?: number
}

/**
 * The code a tool's own error is rejected with. How the runtime hands one on is not verified
 * (claude-connector.ts); the mock rejects it with a code outside the runtime's refusals, which
 * the page reads as the server's error and words by its text.
 */
const TOOL_ERROR = "tool_error"

/** A rejection as the runtime gives one: its code and its message. */
function rejection(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** A recorded answer as the runtime resolves it, `{ payload }`; an error answer rejects its text. */
function answerOf(result: ToolResult): McpAnswer {
  if (result.isError) throw rejection(TOOL_ERROR, resultText(result))
  if (result.structuredContent !== undefined) return { payload: result.structuredContent }
  const text = resultText(result)
  try {
    return { payload: JSON.parse(text) as unknown }
  } catch {
    return { payload: text }
  }
}

/** `fail` read: the runtime code that refuses every call, and each failing tool with its code. */
function failuresOf(fail: readonly string[]) {
  let everyCall: string | undefined
  const tools = new Map<string, string | undefined>()
  for (const entry of fail) {
    const [tool, code] = entry.split(":")
    if (RUNTIME_CODES.has(tool)) everyCall = tool
    else tools.set(tool, code || undefined)
  }
  return { everyCall, tools }
}

/** A call the page made through the mock: the tool and its arguments, in the order made. */
export interface MockCall {
  tool: string
  arguments: Record<string, unknown>
}

/**
 * A `window.claude` that serves `fixture` through the page's own connector path
 * (`claude-connector.ts`) in the runtime's shape: `use("mcp")` resolves to the capability, whose
 * `callTool(server, tool, args, options)` finds the recorded answer by the tool and its canonical
 * arguments and resolves `{ payload }`. An unmatched call and a recorded error reject with
 * `{ code, message }`, a connector of another name with the runtime's `server_not_connected` and
 * a tool outside `PAGE_TOOLS` with its `not_in_manifest`. `calls` lists every call that reached
 * it, so a test counts what one load calls.
 */
export function mockClaude(
  fixture: Fixture,
  options: MockOptions = {},
): ClaudeRuntime & { readonly calls: readonly MockCall[] } {
  const calls: MockCall[] = []
  const answers = new Map(
    fixture.calls.map((call) => [callKey(call.tool, call.arguments), call.result]),
  )
  const { everyCall, tools } = failuresOf(options.fail ?? [])
  const capability: McpCapability = {
    async callTool(server, tool, args) {
      calls.push({ tool, arguments: args })
      if (options.delayMs) await new Promise((done) => setTimeout(done, options.delayMs))
      if (server !== CONNECTOR_NAME) {
        throw rejection("server_not_connected", `No connector named ${server} is connected.`)
      }
      // The published page declares exactly PAGE_TOOLS in its `mcp` capability.
      if (!isPageTool(tool)) {
        throw rejection("not_in_manifest", `The page's mcp capability doesn't name ${tool}.`)
      }
      if (everyCall !== undefined) {
        throw rejection(everyCall, `The fixture refuses every call (${everyCall}).`)
      }
      if (tools.has(tool)) {
        const code = tools.get(tool)
        if (code !== undefined) throw rejection(code, `The fixture refuses ${tool} (${code}).`)
        throw rejection(
          TOOL_ERROR,
          `[503 ServiceUnavailable] The fixture fails ${tool} (engine ${fixture.engine})`,
        )
      }
      const recorded = answers.get(callKey(tool, args))
      if (recorded === undefined) {
        throw rejection(
          TOOL_ERROR,
          `No recorded answer for ${tool} ${JSON.stringify(args)}: record the fixtures again (pnpm record).`,
        )
      }
      return answerOf(recorded)
    },
  }
  return { use: () => Promise.resolve(capability), calls }
}

/** Installs the mock as `window.claude`. */
export function installMockClaude(fixture: Fixture, options: MockOptions = {}): void {
  window.claude = mockClaude(fixture, options)
}
