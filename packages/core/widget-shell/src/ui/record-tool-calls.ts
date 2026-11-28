/**
 * The writer of a recording (recording.ts): a recorder in Node runs a page's reads once against a
 * live server through `recordToolCalls`, which keeps of each answer what the page reads
 * (`RecordedRead`), and refuses a page that calls a tool the server does not mark read-only
 * (`pageToolRefusals`). A page that reads live never holds it.
 */
import { decodeToolResult, type ToolResult } from "../protocol/tool-result.js"
import type { ToolCaller } from "./browser-view-host.js"
import { keptAnswer, textReplacer, type RecordedRead } from "./recorded-answer.js"
import type { RecordedToolCall } from "./recording.js"

/** A result's text parts, each as its text. */
function textParts(result: ToolResult): { type: string; text: string }[] {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => ({ type: "text", text: part.text ?? "" }))
}

/**
 * A result as a recording keeps it: a tool's error with its text, which the page words as the
 * server's; an answer's data (`decodeToolResult`) as `read` keeps it (`keptAnswer`), an object as
 * its structured data, anything else as its text, a text alone through `text`, since it is free
 * text; an answer with neither as none.
 */
function keptResult(
  result: ToolResult,
  read: RecordedRead,
  text: ((text: string) => string) | null,
  lack: (path: string) => void,
): ToolResult {
  if (result.isError) return { isError: true, content: textParts(result) }
  if (result.structuredContent == null && textParts(result).length === 0) return { content: [] }
  const { data, lacking } = keptAnswer(decodeToolResult(result), read, { text })
  lacking.forEach(lack)
  if (typeof data === "object" && data !== null) return { structuredContent: data }
  const shown = typeof data === "string" ? (text?.(data) ?? data) : JSON.stringify(data)
  return { content: [{ type: "text", text: shown }] }
}

export interface RecordToolCallsOptions {
  /**
   * Per tool the page calls, what a recording keeps of its answers: the paths the page reads, its
   * free text and its BPMN diagrams (`RecordedRead`, typed by `recordedRead`). A call to a tool
   * without one is refused before it is made, so no answer is ever recorded whole.
   */
  readonly reads: Readonly<Record<string, RecordedRead>>
  /**
   * Keep free text as it came (each read's `text`, a diagram's documentation and annotations).
   * Default false: each distinct text is replaced by a placeholder of its own.
   */
  readonly keepText?: boolean
}

/** A path a page reads that a tool's answer lacked: the server renamed or dropped the field. */
export interface LackingPath {
  readonly tool: string
  readonly path: string
}

/** A recorder of a page's calls (`recordToolCalls`). */
export interface ToolCallRecorder {
  /** The caller to read through: it answers as the live one does and records what it answered. */
  readonly callTool: ToolCaller
  /** Every call answered, in the order answered, kept as its read says. */
  readonly calls: RecordedToolCall[]
  /** The paths the reads name that an answer lacked, each once per tool. */
  readonly lacking: LackingPath[]
}

/**
 * Records every call that `callTool` answers, in the order answered, kept as `reads` says (the
 * paths the page reads, nothing else; its free text replaced unless `keepText`; its diagrams
 * without what the engine runs): the calls of a recording, which a recorder sorts and writes with
 * its `asOf` and zone. A call to another connection than the caller's own keeps its name; a
 * refused call records nothing, and a call to a tool `reads` does not name is refused unmade.
 */
export function recordToolCalls(
  callTool: ToolCaller,
  { reads, keepText = false }: RecordToolCallsOptions,
): ToolCallRecorder {
  const calls: RecordedToolCall[] = []
  const lacking: LackingPath[] = []
  const text = keepText ? null : textReplacer()
  const recording: ToolCaller = async (tool, args, options) => {
    const read = Object.hasOwn(reads, tool) ? reads[tool] : undefined
    if (read === undefined) {
      throw new Error(`${tool} has no read in the recorder's reads: name what the page reads of it`)
    }
    const result = await callTool(tool, args, options)
    const lack = (path: string) => {
      if (!lacking.some((each) => each.tool === tool && each.path === path)) {
        lacking.push({ tool, path })
      }
    }
    const connector = options?.connector
    calls.push({
      tool,
      arguments: args,
      result: keptResult(result, read, text, lack),
      ...(connector === undefined ? {} : { connector }),
    })
    return result
  }
  return { callTool: recording, calls, lacking }
}

/** A tool as a server lists it (`tools/list`): its name and its annotations. */
export interface ListedTool {
  readonly name: string
  readonly annotations?: { readonly readOnlyHint?: boolean }
}

/**
 * Why a recorder refuses a page that calls `pageTools` on a server that lists `listed`, one line
 * each: a tool the server does not list, and one it lists without `readOnlyHint: true`, since a
 * page writes nothing. None for a page that calls only tools that read.
 */
export function pageToolRefusals(
  pageTools: readonly string[],
  listed: readonly ListedTool[],
): string[] {
  const byName = new Map(listed.map((tool) => [tool.name, tool]))
  return pageTools.flatMap((name) => {
    const tool = byName.get(name)
    if (tool === undefined) return [`${name} is no tool of the server, so the page's call fails`]
    if (tool.annotations?.readOnlyHint === true) return []
    return [
      `${name} is not marked read-only (readOnlyHint: true), and a page writes nothing: ` +
        "it calls only tools that read",
    ]
  })
}
