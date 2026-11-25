// @vitest-environment happy-dom
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getFormatLocale,
  SectionState,
  SectionStateGroup,
  setFormatLocale,
  useLocale,
} from "@miragon/pulse-ui"
import { PAGE_HINTS, type PageHints } from "../page-hints.js"
import { PageGate } from "../page-reads/page-gate.js"
import { settled } from "../page-reads/page-reads.test-support.js"
import { useSectionRead } from "../page-reads/section-read.js"
import { createTestQueryClient } from "../test-view-host.js"
import { useViewHost } from "../view-host.js"
import { ARTIFACT_PAGE_HINTS } from "./artifact-hints.js"
import { refusal, rejectWith, runtimeOf } from "./claude-runtime.test-support.js"
import type { ClaudeRuntime } from "./claude-tool-caller.js"
import { mountClaudeArtifact, type MountClaudeArtifactOptions } from "./mount-claude-artifact.js"

/**
 * A page mounted as a Claude artifact: its reads through the runtime on its connector, claude.ai's
 * theme on the document read and never written, the browser's language over the frame's, the
 * artifact's words with claude.ai's place, no hand-off.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** One section's read of `engine_process_stats`, behind the page's gate. */
function App() {
  const { followUp, writes } = useViewHost()
  const section = useSectionRead(["stats"], (reader) =>
    reader.call<{ running: number }>("engine_process_stats", { processDefinitionKey: "p" }),
  )
  return (
    <main data-testid="app" data-locale={useLocale()} data-follow-up={followUp}>
      <output data-testid="writes">{String(writes)}</output>
      <PageGate>
        <SectionStateGroup>
          <SectionState state={section.state} onRetry={section.retry}>
            {(stats) => <output data-testid="running">{stats.running}</output>}
          </SectionState>
        </SectionStateGroup>
      </PageGate>
    </main>
  )
}

let unmount: (() => void) | undefined

async function mount(options: MountClaudeArtifactOptions): Promise<HTMLElement> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = mountClaudeArtifact(App, { client: createTestQueryClient(), container, ...options })
  })
  await settled()
  return container
}

const textOf = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? ""

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.documentElement.lang = ""
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("style")
  document.body.replaceChildren()
  setFormatLocale(undefined)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The OS prefers dark: a page that writes its theme would write dark. */
function stubDarkOs(): void {
  const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(query))
}

describe("mountClaudeArtifact", () => {
  it("reads through the artifact runtime on the page's connector, with no hand-off and no write", async () => {
    const { runtime, calls } = runtimeOf(() => Promise.resolve({ payload: { running: 3 } }))
    const container = await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(textOf(container, "running")).toBe("3")
    expect(calls).toEqual([
      [
        "Pulse",
        "engine_process_stats",
        { processDefinitionKey: "p" },
        { cache: { staleTime: 30_000, gcTime: 600_000 } },
      ],
    ])
    expect(container.querySelector("[data-testid=app]")?.getAttribute("data-follow-up")).toBe(
      "none",
    )
    expect(textOf(container, "writes")).toBe("false")
  })

  it("reads through a caller the page hands in instead, never the runtime", async () => {
    const use = vi.fn<NonNullable<ClaudeRuntime["use"]>>()
    const callTool = vi.fn(() => Promise.resolve({ structuredContent: { running: 5 } }))
    const container = await mount({ connector: "Pulse", runtime: { use }, callTool, locale: "en" })
    expect(textOf(container, "running")).toBe("5")
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(use).not.toHaveBeenCalled()
  })

  it.each([
    ["en", "Your sign-in to Pulse has expired", ARTIFACT_PAGE_HINTS.en.connectionPlace],
    ["de-DE", "Deine Anmeldung bei Pulse ist abgelaufen", ARTIFACT_PAGE_HINTS.de.connectionPlace],
  ])(
    "%s: says a refused connector once, naming it and claude.ai's place",
    async (locale, title, place) => {
      const { runtime } = runtimeOf(() => refusal("needs_reauth", "sign in"))
      const container = await mount({ connector: "Pulse", runtime, locale })
      const heading = container.querySelectorAll("h2")
      expect([...heading].map((h) => h.textContent)).toEqual([title])
      expect(container.textContent).toContain(`Pulse ${String(place)}`)
    },
  )

  it("words a server's error with the artifact's hints, a page's own where it brings them", async () => {
    const { runtime } = runtimeOf(() =>
      rejectWith({ code: "tool_error", message: "[500] Engine prod failed", server: "Pulse" }),
    )
    const artifact = await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(artifact.textContent).toContain(ARTIFACT_PAGE_HINTS.en.failed)
    await act(async () => unmount?.())

    const own: PageHints = { en: { failed: "Ask the page's team." }, de: PAGE_HINTS.de }
    const page = await mount({ connector: "Pulse", runtime, locale: "en", pageHints: own })
    expect(page.textContent).toContain("Ask the page's team.")
    expect(page.textContent).not.toContain(ARTIFACT_PAGE_HINTS.en.failed)
  })

  it("speaks the browser's language over the frame's lang, and the page's over both", async () => {
    const { runtime } = runtimeOf(() => Promise.resolve({ payload: { running: 1 } }))
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE")
    document.documentElement.lang = "en-US"
    const browser = await mount({ connector: "Pulse", runtime })
    expect(browser.querySelector("[data-testid=app]")?.getAttribute("data-locale")).toBe("de")
    await act(async () => unmount?.())

    document.documentElement.lang = "de-DE"
    const named = await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(named.querySelector("[data-testid=app]")?.getAttribute("data-locale")).toBe("en")
  })

  it("renders the page's dates in the zone it names", async () => {
    const { runtime } = runtimeOf(() => Promise.resolve({ payload: { running: 1 } }))
    await mount({ connector: "Pulse", runtime, locale: "en", timeZone: "Asia/Tokyo" })
    expect(getFormatLocale()?.timeZone).toBe("Asia/Tokyo")
  })

  it("keeps claude.ai's theme: a stamped data-theme stays and is followed, an unstamped root stays bare", async () => {
    stubDarkOs()
    const { runtime } = runtimeOf(() => Promise.resolve({ payload: { running: 1 } }))
    const root = document.documentElement
    const changed: Array<string | null> = []
    const observer = new MutationObserver((records) => {
      changed.push(...records.map((record) => record.attributeName))
    })
    /** Every theme attribute written to the root since the last ask. */
    const writes = () => {
      const seen = [...changed, ...observer.takeRecords().map((record) => record.attributeName)]
      changed.length = 0
      return seen
    }
    root.setAttribute("data-theme", "light")
    // The page's fill writes the root's height; its theme is data-theme, the class and color-scheme.
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] })
    await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(root.getAttribute("data-theme")).toBe("light")
    expect(root.classList.contains("dark")).toBe(false)
    expect(root.style.getPropertyValue("color-scheme")).toBe("")
    expect(writes()).toEqual([])
    // claude.ai switches to dark: the kit's stylesheet follows the attribute, nothing is written.
    await act(async () => root.setAttribute("data-theme", "dark"))
    expect(root.classList.contains("dark")).toBe(false)
    expect(writes()).toEqual(["data-theme"])
    await act(async () => unmount?.())

    root.removeAttribute("data-theme")
    writes()
    await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(root.hasAttribute("data-theme")).toBe(false)
    expect(root.classList.contains("dark")).toBe(false)
    expect(writes()).toEqual([])
    observer.disconnect()
  })

  it("returns the unmount, which empties the page's container", async () => {
    const { runtime } = runtimeOf(() => Promise.resolve({ payload: { running: 1 } }))
    const container = await mount({ connector: "Pulse", runtime, locale: "en" })
    expect(container.textContent).not.toBe("")
    await act(async () => unmount?.())
    unmount = undefined
    expect(container.textContent).toBe("")
  })
})
