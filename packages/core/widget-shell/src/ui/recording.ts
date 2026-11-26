/**
 * A page's tool calls recorded once against a live server and replayed without one: the format's
 * writer (`recordToolCalls`, which a recorder runs in Node under `createPageReader`) and its reader
 * (`playRecording`, a caller for a page's dev build, its tests and its screenshots). Outside
 * page-reads/: a page that reads live never holds it.
 */
import { hashKey } from "@tanstack/react-query"
import { PAGE_ERROR_CODES, type PageErrorCode } from "@miragon/pulse-ui"
import type { ToolResult } from "../protocol/tool-result.js"
import type { ToolCaller } from "./browser-view-host.js"
import { PageCallError } from "./page-reads/page-call-error.js"
import type { ToolCallOptions } from "./view-host.js"

/** One call of a recording, its answer as the server sent it, kept small. */
export interface RecordedToolCall {
  readonly tool: string
  readonly arguments: Readonly<Record<string, unknown>>
  readonly result: ToolResult
  /** The connection the call went to; absent for the page's own. */
  readonly connector?: string
}

/**
 * The calls of one load of a page, all made in one run (ids are per engine boot, so recordings are
 * never joined): when they ran, the zone the days were counted in and every call with its answer.
 */
export interface ToolRecording {
  /** When the calls ran: the page's clock on replay, so relative times read as they did. */
  readonly asOf: string
  /** The IANA zone the days were counted in: the page's on replay, so the calls match. */
  readonly timeZone: string
  readonly calls: readonly RecordedToolCall[]
}

/** A call that reached a replay, as the page made it. */
export interface PlayedCall {
  readonly tool: string
  readonly args: Record<string, unknown>
  readonly options: ToolCallOptions
}

export interface PlayRecordingOptions {
  /**
   * What fails, to see a failure: a tool's name answers that tool with a server's error, a page
   * error code (`needs_reauth`) refuses every call with it, a tool and a code joined by a colon
   * (`engine_process_stats:unavailable`) refuse that tool with it.
   */
  readonly fail?: readonly string[]
  /** How long each answer takes, in ms, to see the skeletons. */
  readonly delayMs?: number
  /** The tools the page declares: any other is refused `not_allowed`, as a runtime refuses it. */
  readonly tools?: readonly string[]
  /** The page's own connection by its name, which a refusal names and a call may name too. */
  readonly connector?: string
  /** Hears every call that reaches the replay, in order. */
  readonly onCall?: (call: PlayedCall) => void
}

/** What a page mounts with to replay a recording: its caller, its zone and its clock. */
export interface PlayedRecording {
  readonly callTool: ToolCaller
  readonly timeZone: string
  readonly now: () => Date
}

function isPageErrorCode(value: string | undefined): value is PageErrorCode {
  return (PAGE_ERROR_CODES as readonly (string | undefined)[]).includes(value)
}

/** `fail` read: the code that refuses every call, and each failing tool with its code, if any. */
function failuresOf(fail: readonly string[]) {
  let everyCall: PageErrorCode | undefined
  const tools = new Map<string, PageErrorCode | undefined>()
  for (const entry of fail) {
    // `split` gives the tool at least, the code where a colon follows it.
    const [tool, code] = entry.split(":") as [string, string?]
    if (isPageErrorCode(tool)) everyCall = tool
    else tools.set(tool, isPageErrorCode(code) ? code : undefined)
  }
  return { everyCall, tools }
}

/** A tool's own error answer, as a server sends one. */
function toolError(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

/**
 * A caller that answers from `recording`: a call finds its answer by its tool, its arguments (their
 * keys in any order) and its connection, a recorded error answer included. A call with no recorded
 * answer answers a tool error that names it, so the page says it like any server's error. Spread it
 * into `mountApp`'s options (its clock and zone with it), or hand its caller to `createPageReader`.
 */
export function playRecording(
  recording: ToolRecording,
  options: PlayRecordingOptions = {},
): PlayedRecording {
  const own = (connector: string | undefined) =>
    connector === undefined || connector === options.connector ? null : connector
  const keyOf = (connector: string | undefined, tool: string, args: object) =>
    hashKey([own(connector), tool, args])
  const answers = new Map(
    recording.calls.map((call) => [keyOf(call.connector, call.tool, call.arguments), call.result]),
  )
  const { everyCall, tools } = failuresOf(options.fail ?? [])
  const declared = options.tools === undefined ? undefined : new Set(options.tools)
  const asOf = Date.parse(recording.asOf)
  const callTool: ToolCaller = async (tool, args, callOptions = {}) => {
    options.onCall?.({ tool, args, options: callOptions })
    if (options.delayMs) await new Promise((done) => setTimeout(done, options.delayMs))
    const at = { tool, connector: callOptions.connector ?? options.connector }
    if (declared !== undefined && !declared.has(tool)) {
      throw new PageCallError("not_allowed", `The page does not declare ${tool}.`, at)
    }
    if (everyCall !== undefined) {
      throw new PageCallError(everyCall, `The recording refuses every call (${everyCall}).`, at)
    }
    if (tools.has(tool)) {
      const code = tools.get(tool)
      if (code !== undefined) {
        throw new PageCallError(code, `The recording refuses ${tool} (${code}).`, at)
      }
      return toolError(`[503 ServiceUnavailable] The recording fails ${tool}.`)
    }
    const recorded = answers.get(keyOf(callOptions.connector, tool, args))
    if (recorded !== undefined) return recorded
    const on = own(callOptions.connector) === null ? "" : ` on ${String(callOptions.connector)}`
    return toolError(
      `No recorded answer for ${tool}${on} ${JSON.stringify(args)}: record the page's calls again.`,
    )
  }
  return { callTool, timeZone: recording.timeZone, now: () => new Date(asOf) }
}

/** A result as a recording keeps it: its structured data, else its text parts, `isError` kept. */
function compact(result: ToolResult): ToolResult {
  if (!result.isError && result.structuredContent != null) {
    return { structuredContent: result.structuredContent }
  }
  const content = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => ({ type: "text", text: part.text ?? "" }))
  return result.isError ? { isError: true, content } : { content }
}

/**
 * Records every call that `callTool` answers, in the order answered, kept small (`compact`): the
 * calls of a recording, which a recorder sorts and writes with its `asOf` and zone. A call to
 * another connection than the caller's own keeps its name; a refused call records nothing.
 */
export function recordToolCalls(callTool: ToolCaller): {
  readonly callTool: ToolCaller
  readonly calls: RecordedToolCall[]
} {
  const calls: RecordedToolCall[] = []
  const recording: ToolCaller = async (tool, args, options) => {
    const result = await callTool(tool, args, options)
    const connector = options?.connector
    calls.push({
      tool,
      arguments: args,
      result: compact(result),
      ...(connector === undefined ? {} : { connector }),
    })
    return result
  }
  return { callTool: recording, calls }
}
