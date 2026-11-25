// @vitest-environment happy-dom
import { useEffect, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { SectionState, SectionStateGroup, type SectionFailure } from "@miragon/pulse-ui"
import type { ToolCaller } from "../browser-view-host.js"
import { PAGE_HINTS, type PageHints } from "../page-hints.js"
import { playRecording } from "../recording.js"
import { PageCallError } from "./page-call-error.js"
import { PageGate, PageGateContext, usePageReads, type PageReads } from "./page-gate.js"
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
import type { PageReader } from "./page-reader.js"
import { useSectionRead } from "./section-read.js"

/**
 * What the reads tell the page as a whole: one state while a refusal of a connection stands (per
 * connection where the page names one), its Try again the page's Refresh; the Refresh itself,
 * which never joins a read sent without it; the bar's freshness and whether a read runs.
 */

afterEach(unmountReads)

const PLACE = "on the bench"
const HINTS: PageHints = {
  en: { ...PAGE_HINTS.en, connectionPlace: PLACE },
  de: { ...PAGE_HINTS.de, connectionPlace: "auf dem Prüfstand" },
}

const played = (fail?: string[]) => playRecording(RECORDING, { connector: "Pulse", fail })

/** Every failure each section showed as its own, render by render. */
const shown = new Map<string, Array<SectionFailure | null | undefined>>()
/** What the bar read last. */
const latest: { bar: PageReads | undefined } = { bar: undefined }

function section(
  id: string,
  key: readonly unknown[],
  read: (reader: PageReader) => Promise<unknown>,
) {
  return function Section() {
    const state = useSectionRead(key, read)
    shown.set(id, [...(shown.get(id) ?? []), state.state.error])
    return (
      <div data-testid={id}>
        <SectionState state={state.state} onRetry={state.retry}>
          {(data) => <output>{JSON.stringify(data)}</output>}
        </SectionState>
      </div>
    )
  }
}

const Stats = section("stats", ["stats", "a"], (reader) => reader.call("stats", { key: "a" }))
const Counts = section("counts", ["counts", "a"], (reader) => reader.call("counts", { key: "a" }))
const Accounts = section("accounts", ["accounts"], (reader) =>
  reader.call("accounts", {}, { connector: "Shop" }),
)

function Bar() {
  const reads = usePageReads()
  useEffect(() => {
    latest.bar = reads
  })
  return (
    <header data-testid="bar">
      <span data-testid="read-at">{reads.readAt?.toISOString() ?? "none"}</span>
      <span data-testid="reading">{String(reads.reading)}</span>
      <button type="button" onClick={reads.refresh}>
        Refresh
      </button>
    </header>
  )
}

/** The page's bar outside the gate, the sections behind it, as a dashboard has them. */
function Page() {
  return (
    <>
      <Bar />
      <main>
        <PageGate>
          <SectionStateGroup>
            <Stats />
            <Counts />
          </SectionStateGroup>
        </PageGate>
      </main>
    </>
  )
}

const headings = (container: HTMLElement) =>
  [...container.querySelectorAll("h2")].map((heading) => heading.textContent)

afterEach(() => {
  shown.clear()
  latest.bar = undefined
})

describe("PageGate", () => {
  it.each(["needs_reauth", "not_connected", "approval_required"])(
    "%s: one state for the page, naming the connection and its place, never a section's own",
    async (code) => {
      const container = await mountReads(Page, {
        callTool: played([code]).callTool,
        pageHints: HINTS,
      })
      expect(headings(container)).toHaveLength(1)
      expect(container.querySelector('[data-testid="stats"]')).toBeNull()
      expect(container.textContent).toContain("Pulse")
      if (code !== "approval_required") expect(container.textContent).toContain(PLACE)
      expect(container.textContent).toContain(`The recording refuses every call (${code}).`)
      expect([...shown.values()].flat().filter(Boolean)).toEqual([])
      expect(textOf(container, "read-at")).toBe("none")
    },
  )

  it("opens on its Try again, the page's Refresh, and reads every section again past the caches", async () => {
    const caller = swappableCaller(played(["needs_reauth"]).callTool)
    const container = await mountReads(Page, { callTool: caller.callTool, pageHints: HINTS })
    expect(headings(container)).toHaveLength(1)
    caller.answer(played().callTool)
    await click(container, "Try again")
    expect(headings(container)).toEqual([])
    expect(phaseOf(container, "stats")).toBe("ready")
    expect(phaseOf(container, "counts")).toBe("ready")
    expect(caller.refreshes("stats")).toEqual([false, true])
    expect(caller.refreshes("counts").at(-1)).toBe(true)
  })

  it("leaves a refusal of one tool to its sections, said once, with no Try again", async () => {
    const container = await mountReads(Page, {
      callTool: played(["not_allowed"]).callTool,
      pageHints: HINTS,
    })
    expect(headings(container)).toEqual([])
    expect(phaseOf(container, "stats")).toBe("error")
    expect(phaseOf(container, "counts")).toBe("error")
    expect(container.querySelectorAll("button")).toHaveLength(1)
    expect(textOf(container, "counts")).not.toContain("Pulse")
  })

  it("covers its own connection where it names one, leaving another's refusal to its sections", async () => {
    const refusing: ToolCaller = async (tool, args, options) => {
      if (options?.connector === undefined) {
        throw new PageCallError("needs_reauth", "expired", { tool, connector: "Pulse" })
      }
      return played().callTool(tool, args, options)
    }
    const Shop = () => (
      <PageGate connector="Shop">
        <Accounts />
        <Stats />
      </PageGate>
    )
    const container = await mountReads(Shop, { callTool: refusing, pageHints: HINTS })
    expect(headings(container)).toEqual([])
    expect(phaseOf(container, "accounts")).toBe("ready")
    expect(phaseOf(container, "stats")).toBe("error")
    expect(textOf(container, "stats")).toContain(`Pulse ${PLACE}`)
    unmountReads()

    const shopRefuses: ToolCaller = async (tool, args, options) => {
      if (options?.connector === "Shop") {
        throw new PageCallError("not_connected", "no shop", { tool, connector: "Shop" })
      }
      return played().callTool(tool, args, options)
    }
    const closed = await mountReads(Shop, { callTool: shopRefuses, pageHints: HINTS })
    expect(headings(closed)).toHaveLength(1)
    expect(closed.textContent).toContain(`Shop ${PLACE}`)
    expect(closed.querySelector('[data-testid="stats"]')).toBeNull()
  })

  it("hides a refusal the nearest gate covers from its sections, even before the gate closes", async () => {
    const UnderGate = ({ connector }: { readonly connector: string | undefined }) => (
      <PageGateContext.Provider value={{ connector }}>
        <Stats />
      </PageGateContext.Provider>
    )
    const refused = played(["needs_reauth"]).callTool
    const hidden = await mountReads(() => <UnderGate connector={undefined} />, {
      callTool: refused,
    })
    expect(phaseOf(hidden, "stats")).toBe("loading")
    unmountReads()
    const named = await mountReads(() => <UnderGate connector="Pulse" />, { callTool: refused })
    expect(phaseOf(named, "stats")).toBe("loading")
    unmountReads()
    const other = await mountReads(() => <UnderGate connector="Shop" />, { callTool: refused })
    expect(phaseOf(other, "stats")).toBe("error")
  })

  it("lets a section without a gate say the refusal itself", async () => {
    const container = await mountReads(Stats, {
      callTool: played(["needs_reauth"]).callTool,
      pageHints: HINTS,
    })
    expect(phaseOf(container, "stats")).toBe("error")
    expect(textOf(container, "stats")).toContain(`Pulse ${PLACE}`)
  })
})

describe("the page's Refresh", () => {
  it("cancels a first load that runs and asks again past the caches, never joining it", async () => {
    const pending: Array<() => void> = []
    const caller = swappableCaller(async (...call) => {
      await new Promise<void>((resolve) => pending.push(resolve))
      return played().callTool(...call)
    })
    const container = await mountReads(Page, { callTool: caller.callTool })
    expect(caller.refreshes("stats")).toEqual([false])
    expect(textOf(container, "reading")).toBe("true")
    await click(container, "Refresh")
    expect(caller.refreshes("stats")).toEqual([false, true])
    expect(caller.refreshes("counts")).toEqual([false, true])
    for (const release of pending.splice(0)) release()
    await settled()
    expect(phaseOf(container, "stats")).toBe("ready")
    expect(textOf(container, "reading")).toBe("false")
    expect(caller.calls).toHaveLength(4)
  })

  it("reads every section again past the caches, after the first read too", async () => {
    const caller = swappableCaller(played().callTool)
    const container = await mountReads(Page, { callTool: caller.callTool })
    await click(container, "Refresh")
    await click(container, "Refresh")
    expect(caller.refreshes("stats")).toEqual([false, true, true])
    expect(phaseOf(container, "stats")).toBe("ready")
  })
})

describe("usePageReads", () => {
  it("dates the page by its oldest mounted section, keeps that on a failed refresh, and none while refused", async () => {
    const caller = swappableCaller(played().callTool)
    const container = await mountReads(Page, { callTool: caller.callTool })
    expect(textOf(container, "read-at")).toBe(COUNTS_AT)

    caller.answer(async (tool, args, options) =>
      tool === "counts"
        ? toolError("[503 ServiceUnavailable] down")
        : played().callTool(tool, args, options),
    )
    await click(container, "Refresh")
    expect(phaseOf(container, "counts")).toBe("stale")
    expect(textOf(container, "read-at")).toBe(COUNTS_AT)

    caller.answer(played(["needs_reauth"]).callTool)
    await click(container, "Refresh")
    expect(headings(container)).toHaveLength(1)
    expect(textOf(container, "read-at")).toBe("none")
  })

  it("counts only the sections on screen", async () => {
    const Toggled = () => {
      const [counts, setCounts] = useState(true)
      return (
        <>
          <Bar />
          <button type="button" onClick={() => setCounts(false)}>
            Hide counts
          </button>
          {counts && <Counts />}
          <Stats />
        </>
      )
    }
    const container = await mountReads(Toggled, { callTool: played().callTool })
    expect(textOf(container, "read-at")).toBe(COUNTS_AT)
    await click(container, "Hide counts")
    expect(textOf(container, "read-at")).toBe(STATS_AT)
  })

  it("gives the page's clock, else now", async () => {
    const now = () => new Date("2026-11-25T12:00:00.000Z")
    await mountReads(Bar, { callTool: played().callTool, now })
    expect(latest.bar?.now()).toEqual(now())
    unmountReads()
    await mountReads(Bar, { callTool: played().callTool })
    const before = Date.now()
    expect(latest.bar?.now().getTime()).toBeGreaterThanOrEqual(before)
    expect(latest.bar?.readAt).toBeUndefined()
    expect(latest.bar?.reading).toBe(false)
  })
})
