import { describe, expect, it, vi } from "vitest"
import type { ToolCaller } from "./browser-view-host.js"
import { PageCallError } from "./page-reads/page-call-error.js"
import { createPageReader } from "./page-reads/page-reader.js"
import { pageToolRefusals, recordToolCalls } from "./record-tool-calls.js"
import type { RecordedRead } from "./recorded-answer.js"
import { playRecording } from "./recording.js"

/**
 * The writer of a recording: each answer kept as the page's read says, a tool's error with its
 * text, a call to a tool without a read refused unmade, the paths an answer lacks told; and the
 * refusal of a page that calls a tool the server does not mark read-only.
 */

const WHOLE: RecordedRead = { paths: [""] }

describe("recordToolCalls", () => {
  it("records each answered call as its read keeps it, a tool's error with its text", async () => {
    const live = vi.fn<ToolCaller>(async (tool) => {
      if (tool === "structured") {
        return { structuredContent: { a: 1, b: 2 }, content: [{ type: "text", text: "summary" }] }
      }
      if (tool === "text") {
        return { content: [{ type: "image" }, { type: "text", text: '{"b":2,"c":3}' }] }
      }
      if (tool === "error") {
        return { isError: true, structuredContent: { x: 1 }, content: [{ type: "text" }] }
      }
      if (tool === "empty") return {}
      if (tool === "plain")
        return { structuredContent: null, content: [{ type: "text", text: "t" }] }
      if (tool === "count") return { content: [{ type: "text", text: "7" }] }
      throw new PageCallError("not_allowed", "no")
    })
    const reads = {
      structured: { paths: ["a"] },
      text: { paths: ["b"] },
      error: WHOLE,
      empty: WHOLE,
      plain: WHOLE,
      count: WHOLE,
      refused: WHOLE,
    }
    const { callTool, calls } = recordToolCalls(live, { reads })
    const full = await callTool("structured", { q: 1 })
    expect(full.content).toEqual([{ type: "text", text: "summary" }])
    await callTool("text", {}, { connector: "Acme CRM", refresh: true })
    for (const tool of ["error", "empty", "plain", "count"]) await callTool(tool, {})
    await expect(callTool("refused", {})).rejects.toBeInstanceOf(PageCallError)
    expect(live).toHaveBeenCalledWith("text", {}, { connector: "Acme CRM", refresh: true })
    expect(calls).toEqual([
      { tool: "structured", arguments: { q: 1 }, result: { structuredContent: { a: 1 } } },
      {
        tool: "text",
        arguments: {},
        result: { structuredContent: { b: 2 } },
        connector: "Acme CRM",
      },
      {
        tool: "error",
        arguments: {},
        result: { isError: true, content: [{ type: "text", text: "" }] },
      },
      { tool: "empty", arguments: {}, result: { content: [] } },
      {
        tool: "plain",
        arguments: {},
        result: { content: [{ type: "text", text: "Text left out of the recording (1)" }] },
      },
      { tool: "count", arguments: {}, result: { content: [{ type: "text", text: "7" }] } },
    ])
  })

  it("keeps a text answer as it came with keepText, and replaces each distinct text once", async () => {
    const live: ToolCaller = async (_tool, args) => ({
      structuredContent: { message: args.message, kept: args.message },
    })
    const reads = { t: { paths: ["message", "kept"], text: ["message"] } }
    const replaced = recordToolCalls(live, { reads })
    for (const message of ["boom", "bang", "boom"]) await replaced.callTool("t", { message })
    expect(replaced.calls.map((call) => call.result.structuredContent)).toEqual([
      { message: "Text left out of the recording (1)", kept: "boom" },
      { message: "Text left out of the recording (2)", kept: "bang" },
      { message: "Text left out of the recording (1)", kept: "boom" },
    ])
    const kept = recordToolCalls(live, { reads, keepText: true })
    await kept.callTool("t", { message: "boom" })
    expect(kept.calls[0]?.result.structuredContent).toEqual({ message: "boom", kept: "boom" })
    const plain = recordToolCalls(async () => ({ content: [{ type: "text", text: "boom" }] }), {
      reads: { t: WHOLE },
      keepText: true,
    })
    await plain.callTool("t", {})
    expect(plain.calls[0]?.result).toEqual({ content: [{ type: "text", text: "boom" }] })
  })

  it("refuses a call to a tool its reads do not name, before the call, inherited names included", async () => {
    const live = vi.fn<ToolCaller>(async () => ({ structuredContent: {} }))
    const { callTool, calls } = recordToolCalls(live, { reads: { known: WHOLE } })
    await expect(callTool("unknown", {})).rejects.toThrow(
      "unknown has no read in the recorder's reads: name what the page reads of it",
    )
    await expect(callTool("toString", {})).rejects.toThrow(/toString has no read/)
    expect(live).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it("tells each path an answer lacks once per tool, a null on the way none", async () => {
    const live: ToolCaller = async (tool) => ({
      structuredContent: tool === "a" ? { now: { running: 1 }, durations: null } : { other: 1 },
    })
    const reads = {
      a: { paths: ["now.running", "now.incidents", "durations.from", "asOf"] },
      b: { paths: ["asOf"] },
    }
    const { callTool, lacking } = recordToolCalls(live, { reads })
    await callTool("a", { n: 1 })
    await callTool("a", { n: 2 })
    await callTool("b", {})
    expect(lacking).toEqual([
      { tool: "a", path: "asOf" },
      { tool: "a", path: "now.incidents" },
      { tool: "b", path: "asOf" },
    ])
  })

  it("writes what playRecording reads", async () => {
    const live: ToolCaller = async (tool, args) => ({ structuredContent: { tool, args } })
    const recorder = recordToolCalls(live, {
      reads: { engine_process_stats: WHOLE, crm_accounts: { paths: ["tool"] } },
    })
    const reader = createPageReader(recorder.callTool)
    const first = await reader.call("engine_process_stats", { b: 1, a: 2 })
    await reader.call("crm_accounts", {}, { connector: "Acme CRM" })
    const replay = playRecording(
      { asOf: "2026-11-25T09:00:00.000Z", timeZone: "UTC", calls: recorder.calls },
      { connector: "Pulse" },
    )
    const again = createPageReader(replay.callTool)
    expect(await again.call("engine_process_stats", { a: 2, b: 1 })).toEqual(first)
    expect(await again.call("crm_accounts", {}, { connector: "Acme CRM" })).toEqual({
      tool: "crm_accounts",
    })
  })
})

describe("pageToolRefusals", () => {
  const listed = [
    { name: "engine_process_stats", annotations: { readOnlyHint: true } },
    { name: "engine_delete_process_instance", annotations: { readOnlyHint: false } },
    { name: "engine_unmarked" },
  ]

  it("passes a page that calls only tools the server marks read-only", () => {
    expect(pageToolRefusals(["engine_process_stats"], listed)).toEqual([])
  })

  it("refuses a tool marked otherwise or not at all, and one the server does not list", () => {
    const tools = ["engine_delete_process_instance", "engine_unmarked", "engine_made_up"]
    expect(pageToolRefusals(tools, listed)).toEqual([
      "engine_delete_process_instance is not marked read-only (readOnlyHint: true), and a page " +
        "writes nothing: it calls only tools that read",
      "engine_unmarked is not marked read-only (readOnlyHint: true), and a page writes nothing: " +
        "it calls only tools that read",
      "engine_made_up is no tool of the server, so the page's call fails",
    ])
  })
})
