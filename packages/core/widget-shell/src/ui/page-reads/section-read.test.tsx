// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { onlineManager, QueryClient } from "@tanstack/react-query"
import { getFormatTimeZone, SectionState, SectionStateGroup } from "@miragon/pulse-ui"
import type { ToolCaller } from "../browser-view-host.js"
import { PAGE_HINTS } from "../page-hints.js"
import { playRecording } from "../recording.js"
import { createTestQueryClient } from "../test-view-host.js"
import { createViewQueryClient } from "../tool-query.js"
import { PageCallError } from "./page-call-error.js"
import {
  click,
  COUNTS_AT,
  mountReads,
  phaseOf,
  RECORDING,
  settled,
  STATS_AT,
  swappableCaller,
  textOf,
  toolError,
  unmountReads,
} from "./page-reads.test-support.js"
import { usePageReads } from "./page-gate.js"
import type { PageReader } from "./page-reader.js"
import { useSectionRead, type SectionRead } from "./section-read.js"

/**
 * One section's read: loading, ready, stale and failed on its own; sections with one key share
 * one read; Try again asks the server; when its data was read; the view runtime's retries for a
 * transient failure, none for a refusal or a permanent error.
 */

afterEach(unmountReads)

const played = () => playRecording(RECORDING, { connector: "Pulse" })

/** The last read of each section, by its test id. */
const reads = new Map<string, SectionRead<unknown>>()

type Read = (reader: PageReader) => Promise<unknown>

const readStats: Read = (reader) => reader.call("stats", { key: "a" })
const readBoth: Read = async (reader) => [
  await reader.call("stats", { key: "a" }),
  await reader.call("counts", { key: "a" }),
]

function section(id: string, key: readonly unknown[], read: Read) {
  return function Section() {
    const state = useSectionRead(key, read)
    reads.set(id, state)
    return (
      <div data-testid={id}>
        <SectionState state={state.state} onRetry={state.retry}>
          {(data) => <output>{JSON.stringify(data)}</output>}
        </SectionState>
      </div>
    )
  }
}

const Stats = section("stats", ["stats", "a"], readStats)

/** The bar's Refresh, as a page's header has it. */
function RefreshButton() {
  const { refresh } = usePageReads()
  return (
    <button type="button" onClick={refresh}>
      Refresh
    </button>
  )
}

describe("useSectionRead", () => {
  it("loads, shows its data, keeps it with the failure of a later read, and fails without data", async () => {
    const caller = swappableCaller(played().callTool)
    const container = await mountReads(
      () => (
        <>
          <RefreshButton />
          <Stats />
        </>
      ),
      { callTool: caller.callTool },
    )
    expect(phaseOf(container, "stats")).toBe("ready")
    expect(textOf(container, "stats")).toContain('"running":3')
    expect(reads.get("stats")?.at).toEqual(new Date(STATS_AT))

    caller.answer(async () => toolError("[503 ServiceUnavailable] engine prod down (engine prod)"))
    await click(container, "Refresh")
    expect(phaseOf(container, "stats")).toBe("stale")
    expect(textOf(container, "stats")).toContain('"running":3')
    expect(textOf(container, "stats")).toContain("prod")
    expect(reads.get("stats")?.at).toEqual(new Date(STATS_AT))
    expect(reads.get("stats")?.error?.message).toContain("[503 ServiceUnavailable]")

    const Fresh = section("fresh", ["fresh"], readStats)
    const failing = await mountReads(Fresh, { callTool: caller.callTool })
    expect(phaseOf(failing, "fresh")).toBe("error")
    expect(reads.get("fresh")?.data).toBeUndefined()
    expect(reads.get("fresh")?.at).toBeUndefined()
  })

  it("shows the skeleton while it reads, busy", async () => {
    let release: () => void = () => undefined
    const gated: ToolCaller = async (...call) => {
      await new Promise<void>((resolve) => (release = resolve))
      return played().callTool(...call)
    }
    const container = await mountReads(Stats, { callTool: gated })
    expect(phaseOf(container, "stats")).toBe("loading")
    expect(reads.get("stats")?.loading).toBe(true)
    expect(reads.get("stats")?.state.loading).toBe(true)
    release()
    await settled()
    expect(phaseOf(container, "stats")).toBe("ready")
    expect(reads.get("stats")?.loading).toBe(false)
  })

  it("asks the server on Try again, and makes one call for two sections of one key", async () => {
    const caller = swappableCaller(async () => toolError("[503 ServiceUnavailable] down"))
    const First = section("first", ["stats", "a"], readStats)
    const Second = section("second", ["stats", "a"], readStats)
    const container = await mountReads(
      () => (
        <SectionStateGroup>
          <First />
          <Second />
        </SectionStateGroup>
      ),
      { callTool: caller.callTool },
    )
    expect(caller.refreshes("stats")).toEqual([false])
    expect(phaseOf(container, "first")).toBe("error")
    caller.answer(played().callTool)
    await click(container, "Try again", "first")
    expect(caller.refreshes("stats")).toEqual([false, true])
    expect(phaseOf(container, "first")).toBe("ready")
    expect(phaseOf(container, "second")).toBe("ready")
  })

  it("dates its data by the oldest answer's asOf, else by the page's clock when it finished", async () => {
    const Both = section("both", ["both"], readBoth)
    const Plain = section("plain", ["plain"], (reader) => reader.call("plain"))
    const now = () => new Date("2026-11-25T12:00:00.000Z")
    await mountReads(
      () => (
        <>
          <Both />
          <Plain />
        </>
      ),
      { callTool: played().callTool, now },
    )
    expect(reads.get("both")?.at).toEqual(new Date(COUNTS_AT))
    expect(reads.get("plain")?.at).toEqual(now())
  })

  it("reads in the page's zone, else in the one its dates render in", async () => {
    const zones: string[] = []
    const Zone = section("zone", ["zone"], async (reader) => {
      zones.push(reader.timeZone)
      return reader.call("plain")
    })
    await mountReads(Zone, { callTool: played().callTool, timeZone: "Asia/Tokyo" })
    unmountReads()
    await mountReads(Zone, { callTool: played().callTool, timeZone: "Mars/Olympus" })
    expect(zones).toEqual(["Asia/Tokyo", getFormatTimeZone()])
  })

  it("reads while the browser says it is offline: the transport decides", async () => {
    onlineManager.setOnline(false)
    try {
      const container = await mountReads(Stats, { callTool: played().callTool })
      expect(phaseOf(container, "stats")).toBe("ready")
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it("words its failure in the host's words: the page's hints, the connection's name", async () => {
    const hints = {
      en: { ...PAGE_HINTS.en, failed: "Ask the bench.", connectionPlace: "on the bench" },
      de: PAGE_HINTS.de,
    }
    const refusing: ToolCaller = async () => {
      throw new PageCallError("needs_reauth", "[needs_reauth] expired", { connector: "Pulse" })
    }
    const container = await mountReads(Stats, { callTool: refusing, pageHints: hints })
    expect(textOf(container, "stats")).toContain("Pulse on the bench")
    unmountReads()
    const failing: ToolCaller = async () =>
      toolError("[500 ProcessEngineException] boom (engine prod)")
    const failed = await mountReads(Stats, { callTool: failing, pageHints: hints })
    expect(textOf(failed, "stats")).toContain("Ask the bench.")
    expect(textOf(failed, "stats")).toContain("[500 ProcessEngineException] boom")
  })
})

describe("useSectionRead retries as every view's read does", () => {
  /** The view's client, its backoff cut to nothing. */
  function viewClient(): QueryClient {
    const client = createViewQueryClient()
    client.setDefaultOptions({
      queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
    })
    return client
  }

  // Three retries of a transient failure make four calls, never sixteen: a call is never retried
  // inside its section's retries (the call level's `retry: false`).
  it.each([
    {
      name: "a transient server error",
      answer: async () => toolError("[503 ServiceUnavailable] down"),
      calls: 4,
    },
    {
      name: "a connection that does not answer",
      answer: async () => Promise.reject(new PageCallError("unavailable", "no answer")),
      calls: 4,
    },
    {
      name: "a refusal of the page",
      answer: async () => Promise.reject(new PageCallError("not_allowed", "not declared")),
      calls: 1,
    },
    {
      name: "a refusal of the connection",
      answer: async () => Promise.reject(new PageCallError("needs_reauth", "expired")),
      calls: 1,
    },
    {
      name: "a permanent error",
      answer: async () => toolError("Input validation error: unknown key"),
      calls: 1,
    },
    {
      name: "arguments the tool does not take, as claude.ai's artifact runtime hands them on",
      answer: async () => toolError('Invalid arguments for tool stats: Unknown key "n".'),
      calls: 1,
    },
  ] satisfies ReadonlyArray<{ name: string; answer: ToolCaller; calls: number }>)(
    "$name: $calls call(s) in all, each retry past the caches",
    async ({ answer, calls }) => {
      const caller = swappableCaller(answer)
      await mountReads(Stats, { callTool: caller.callTool, client: viewClient() })
      await settled(8)
      expect(caller.calls).toHaveLength(calls)
      expect(caller.refreshes("stats").slice(1).every(Boolean)).toBe(true)
    },
  )

  it("follows the client's own count, or TanStack's three where it names none", async () => {
    const once = swappableCaller(async () => toolError("[503 ServiceUnavailable] down"))
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    await mountReads(Stats, { callTool: once.callTool, client })
    await settled(6)
    expect(once.calls).toHaveLength(2)
    const plain = swappableCaller(once.callTool)
    const bare = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    await mountReads(section("bare", ["bare"], readStats), {
      callTool: plain.callTool,
      client: bare,
    })
    await settled(8)
    expect(plain.calls).toHaveLength(4)
    const none = swappableCaller(once.callTool)
    await mountReads(section("none", ["none"], readStats), {
      callTool: none.callTool,
      client: createTestQueryClient(),
    })
    expect(none.calls).toHaveLength(1)
  })
})
