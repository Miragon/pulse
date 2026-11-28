import { readdirSync, readFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import {
  createPageReader,
  playRecording,
  recordToolCalls,
  type RecordedToolCall,
} from "@miragon/pulse-widget-shell/widgets"
import { describe, expect, it } from "vitest"
import type { Fixture } from "../fixtures/fixture.ts"
import { clearTextTokenRefusal, isLoopbackHost } from "../scripts/token-target.ts"
import {
  DASHBOARD_READS,
  type ActivityCounts,
  type ActivityRow,
  type DiagramXml,
} from "../src/data/process-dashboard.ts"
import { RECORDED_READS } from "../src/data/recorded-reads.ts"
import { PAGE_TOOLS, PROCESS_KEY } from "../src/page.config.ts"

const DIR = new URL("../fixtures/", import.meta.url)
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".json"))
const fixtureOf = (name: string) => JSON.parse(readFileSync(new URL(name, DIR), "utf8")) as Fixture

/**
 * `fixture` recorded again from itself, as `pnpm record -- --from` records it: its free text kept
 * only where the recording says it kept it (`keepText`, written by `pnpm record -- --keep-text`).
 */
async function recordedAgain(fixture: Fixture) {
  const played = playRecording(fixture, { tools: PAGE_TOOLS })
  const again = recordToolCalls(played.callTool, {
    reads: RECORDED_READS,
    keepText: fixture.keepText === true,
  })
  const reader = createPageReader(again.callTool, played)
  for (const read of Object.values(DASHBOARD_READS)) await read(reader, fixture.process)
  return again
}

const byCall = (call: RecordedToolCall) => `${call.tool} ${JSON.stringify(call.arguments)}`
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null))

/** The calls, by tool and arguments, that recording `fixture` again changes, adds or drops. */
async function changedCalls(fixture: Fixture): Promise<string[]> {
  const { calls } = await recordedAgain(fixture)
  const keys = new Set([...fixture.calls, ...calls].map(byCall))
  const callOf = (list: readonly RecordedToolCall[], key: string) =>
    asJson(list.find((call) => byCall(call) === key))
  return [...keys].filter(
    (key) => !isDeepStrictEqual(callOf(fixture.calls, key), callOf(calls, key)),
  )
}

/** An activity with an engine's raw incident message, as `--keep-text` would keep it. */
const RAW_INCIDENT: ActivityRow = {
  activityId: "Activity_Planted",
  name: "Planted",
  running: 1,
  openTasks: 0,
  oldestOpenTask: null,
  incidents: 1,
  incidentsInCalledInstances: 0,
  failedJobs: 1,
  latestIncident: { message: "java.sql.SQLException: password=hunter2", at: "2026-11-24T00:00Z" },
  latestIncidentInCalledInstances: null,
}

/** `fixture` with `change` applied to the structured answer of each call of `tool`. */
function planted<T>(fixture: Fixture, tool: string, change: (answer: T) => T): Fixture {
  const calls = fixture.calls.map((call) =>
    call.tool === tool
      ? { ...call, result: { structuredContent: change(call.result.structuredContent as T) } }
      : call,
  )
  return { ...fixture, calls }
}

describe("the recorded fixtures", () => {
  it("hold the dashboard's process", () => {
    expect(FILES).toContain(`${PROCESS_KEY}.json`)
  })

  it.each(FILES)(
    "%s: answers every call the dashboard's reads make, through the page's reader",
    async (name) => {
      const fixture = fixtureOf(name)
      expect(name).toBe(`${fixture.process}.json`)
      const { callTool, now, timeZone } = playRecording(fixture, { tools: PAGE_TOOLS })
      const reader = createPageReader(callTool, { now, timeZone })
      for (const [section, read] of Object.entries(DASHBOARD_READS)) {
        await expect(read(reader, fixture.process), section).resolves.toBeDefined()
      }
    },
  )

  it.each(FILES)(
    "%s: holds only what the page reads, as pnpm record keeps it, its text as it says",
    async (name) => {
      const fixture = fixtureOf(name)
      // Recorded again from itself, a recording changes not a byte: one that holds a field the
      // page does not read or what the diagram's engine runs would, and so would an incident's
      // message or the diagram's documentation as it came, unless the recording says keepText.
      expect(await changedCalls(fixture)).toEqual([])
      expect((await recordedAgain(fixture)).lacking).toEqual([])
      expect(JSON.stringify(fixture)).not.toContain("extensionElements")
    },
  )

  it("the check above fails on text kept as it came, unless the recording says it kept it", async () => {
    const fixture = fixtureOf(`${PROCESS_KEY}.json`)
    const message = planted<ActivityCounts>(fixture, "engine_activity_counts", (counts) => ({
      ...counts,
      activities: [...counts.activities, RAW_INCIDENT],
    }))
    const diagram = "engine_get_process_definition_xml"
    const documentation = planted<DiagramXml>(fixture, diagram, ({ bpmn20Xml }) => ({
      bpmn20Xml: (bpmn20Xml ?? "").replace(
        /<((?:[\w.-]+:)?)process\b[^>]*>/,
        (tag, prefix: string) => `${tag}<${prefix}documentation>Call Bob</${prefix}documentation>`,
      ),
    }))
    expect(documentation).not.toEqual(fixture)
    for (const [tool, kept] of [
      ["engine_activity_counts", message],
      [diagram, documentation],
    ] as const) {
      const changed = await changedCalls({ ...kept, keepText: false })
      expect(changed.filter((call) => call.startsWith(`${tool} `))).toHaveLength(1)
      expect(await changedCalls({ ...kept, keepText: true })).toEqual([])
    }
  })

  it("refuses a tool outside PAGE_TOOLS as the runtime refuses one the page does not declare", async () => {
    const { callTool } = playRecording(fixtureOf(`${PROCESS_KEY}.json`), { tools: PAGE_TOOLS })
    await expect(callTool("engine_open_cockpit", {})).rejects.toMatchObject({
      code: "not_allowed",
      tool: "engine_open_cockpit",
    })
  })
})

describe("the recorder's token", () => {
  const TOKEN = "eyJhbGciOiJSUzI1NiJ9.secret"
  const refusal = (url: string, token: string | undefined) =>
    clearTextTokenRefusal(new URL(url), token)

  it("refuses to send MCP_TOKEN over plain http beyond loopback, naming the host, never the token", () => {
    const text = refusal("http://pulse.internal:8400/mcp", TOKEN)
    expect(text).toContain("pulse.internal:8400")
    expect(text).not.toContain(TOKEN)
    expect(refusal("http://10.0.0.7/mcp", TOKEN)).toContain("10.0.0.7")
    expect(refusal("http://localhost.example.com/mcp", TOKEN)).not.toBeNull()
  })

  it("sends it over https, to a loopback host, and sends nothing without one", () => {
    expect(refusal("https://pulse.example.com/mcp", TOKEN)).toBeNull()
    for (const url of [
      "http://localhost:8400/mcp",
      "http://LOCALHOST:8400/mcp",
      "http://127.0.0.1:8400/mcp",
      "http://127.8.9.10/mcp",
      "http://[::1]:8400/mcp",
    ]) {
      expect(refusal(url, TOKEN), url).toBeNull()
    }
    expect(refusal("http://pulse.internal/mcp", undefined)).toBeNull()
    expect(refusal("http://pulse.internal/mcp", "")).toBeNull()
  })

  it("counts localhost, [::1] and 127.0.0.0/8 as loopback, nothing else", () => {
    expect(["localhost", "[::1]", "127.0.0.1", "127.255.0.1"].every(isLoopbackHost)).toBe(true)
    expect(
      ["0.0.0.0", "128.0.0.1", "127.0.0.1.example.com", "::1", "local"].some(isLoopbackHost),
    ).toBe(false)
  })
})
