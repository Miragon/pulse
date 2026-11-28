import { afterEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../protocol/tool-result.js"
import { PageCallError } from "./page-reads/page-call-error.js"
import { createPageReader } from "./page-reads/page-reader.js"
import { playRecording, type PlayedCall, type ToolRecording } from "./recording.js"

/**
 * A page's calls recorded once and replayed: the replay finds an answer by tool, arguments and
 * connection, fails what `fail` names, refuses an undeclared tool, and says a call it has no
 * answer for (the recorder's own suite: record-tool-calls.test.ts).
 */

const stats = { structuredContent: { asOf: "2026-11-25T09:00:00.000Z", running: 3 } }
const counts = { content: [{ type: "text", text: '{"counts":[]}' }] }
const crm = { structuredContent: { accounts: 2 } }

const RECORDING: ToolRecording = {
  asOf: "2026-11-25T09:00:00.000Z",
  timeZone: "Europe/Berlin",
  calls: [
    { tool: "engine_process_stats", arguments: { key: "a", bucket: "day" }, result: stats },
    { tool: "engine_activity_counts", arguments: { key: "a" }, result: counts },
    { tool: "crm_accounts", arguments: {}, result: crm, connector: "Acme CRM" },
    { tool: "engine_bpmn_xml", arguments: { key: "b" }, result: { isError: true, content: [] } },
  ],
}

const text = (result: ToolResult) => result.content?.[0]?.text

afterEach(() => {
  vi.useRealTimers()
})

describe("playRecording", () => {
  it("answers by tool and arguments in any key order, and by connection, absent for the page's own", async () => {
    const { callTool } = playRecording(RECORDING, { connector: "Pulse" })
    expect(await callTool("engine_process_stats", { bucket: "day", key: "a" })).toBe(stats)
    expect(await callTool("engine_activity_counts", { key: "a" }, { connector: "Pulse" })).toBe(
      counts,
    )
    expect(await callTool("crm_accounts", {}, { connector: "Acme CRM" })).toBe(crm)
    expect((await callTool("crm_accounts", {})).isError).toBe(true)
    expect((await callTool("engine_bpmn_xml", { key: "b" })).isError).toBe(true)
  })

  it("replays the recording's clock and zone", () => {
    const played = playRecording(RECORDING)
    expect(played.timeZone).toBe("Europe/Berlin")
    expect(played.now()).toEqual(new Date("2026-11-25T09:00:00.000Z"))
    expect(played.now()).not.toBe(played.now())
  })

  it("answers a call it has no answer for with a tool error that names it", async () => {
    const { callTool } = playRecording(RECORDING, { connector: "Pulse" })
    const own = await callTool("engine_process_stats", { key: "z" })
    expect(own.isError).toBe(true)
    expect(text(own)).toBe(
      `No recorded answer for engine_process_stats {"key":"z"}: record the page's calls again.`,
    )
    const other = await callTool("crm_accounts", { q: 1 }, { connector: "Shop" })
    expect(text(other)).toBe(
      `No recorded answer for crm_accounts on Shop {"q":1}: record the page's calls again.`,
    )
  })

  it("fails a tool by its name with a server's error, and refuses by a code, for every call or one tool", async () => {
    const failing = playRecording(RECORDING, { fail: ["engine_process_stats"] }).callTool
    const answer = await failing("engine_process_stats", { key: "a", bucket: "day" })
    expect(answer).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "[503 ServiceUnavailable] The recording fails engine_process_stats.",
        },
      ],
    })
    expect(await failing("engine_activity_counts", { key: "a" })).toBe(counts)

    const refused = playRecording(RECORDING, { fail: ["needs_reauth"], connector: "Pulse" })
    const everyCall = await refused
      .callTool("engine_activity_counts", { key: "a" })
      .catch((e: unknown) => e)
    expect(everyCall).toBeInstanceOf(PageCallError)
    expect(everyCall).toMatchObject({
      code: "needs_reauth",
      tool: "engine_activity_counts",
      connector: "Pulse",
      detail: "The recording refuses every call (needs_reauth).",
    })

    const one = playRecording(RECORDING, { fail: ["engine_process_stats:unavailable", ""] })
    await expect(
      one.callTool("engine_process_stats", {}, { connector: "Acme CRM" }),
    ).rejects.toMatchObject({
      code: "unavailable",
      connector: "Acme CRM",
      detail: "The recording refuses engine_process_stats (unavailable).",
    })
    expect(await one.callTool("engine_activity_counts", { key: "a" })).toBe(counts)

    const unknownCode = playRecording(RECORDING, { fail: ["engine_activity_counts:later"] })
    expect((await unknownCode.callTool("engine_activity_counts", { key: "a" })).isError).toBe(true)
  })

  it("refuses a tool the page does not declare, as a runtime does", async () => {
    const { callTool } = playRecording(RECORDING, {
      tools: ["engine_activity_counts"],
      fail: ["unavailable"],
    })
    await expect(
      callTool("engine_process_stats", { key: "a", bucket: "day" }),
    ).rejects.toMatchObject({
      code: "not_allowed",
      detail: "The page does not declare engine_process_stats.",
    })
    await expect(callTool("engine_activity_counts", { key: "a" })).rejects.toMatchObject({
      code: "unavailable",
    })
  })

  it("tells every call it hears, with the options the page gave, and takes its time where told", async () => {
    vi.useFakeTimers()
    const heard: PlayedCall[] = []
    const { callTool } = playRecording(RECORDING, {
      delayMs: 800,
      onCall: (call) => heard.push(call),
    })
    const answer = callTool("engine_activity_counts", { key: "a" }, { refresh: true })
    callTool("crm_accounts", {}, { connector: "Acme CRM" }).catch(() => undefined)
    expect(heard).toEqual([
      { tool: "engine_activity_counts", args: { key: "a" }, options: { refresh: true } },
      { tool: "crm_accounts", args: {}, options: { connector: "Acme CRM" } },
    ])
    let settled = false
    void answer.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(799)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await answer).toBe(counts)
    expect(
      (await playRecording(RECORDING).callTool("engine_activity_counts", { key: "a" })).content,
    ).toEqual(counts.content)
  })

  it("replays the page's reads in Node, through the page's reader", async () => {
    const played = playRecording(RECORDING, { tools: ["engine_process_stats"] })
    const reader = createPageReader(played.callTool, played)
    expect(await reader.call("engine_process_stats", { key: "a", bucket: "day" })).toEqual(
      stats.structuredContent,
    )
    await expect(reader.call("engine_activity_counts", { key: "a" })).rejects.toMatchObject({
      code: "not_allowed",
    })
    expect([reader.timeZone, reader.now()]).toEqual([played.timeZone, played.now()])
  })
})
