// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { queryClient, useLocale } from "@miragon/mcp-toolkit-ui"
import { HostBridgeProvider, type HostBridge } from "@miragon/mcp-toolkit-ui/app"
import { SHELL_SETTINGS_DATA } from "../shell-settings-contract.js"
import { ProfileGate } from "./profile-gate.js"
import { SHELL_SETTINGS_KEY } from "./shell-settings.js"
import { formatTimestamp, setFormatLocale } from "./format.js"
import { ShellHostProvider, type ShellHost } from "./shell-host.js"

const FEED = SHELL_SETTINGS_DATA
const ISO = "2026-07-22T22:15:30.000Z"

function feedResult(view: { language?: string; theme?: string }) {
  return {
    content: [{ type: "text", text: JSON.stringify(view) }],
    structuredContent: view,
  }
}

function bridgeWith(callTool: HostBridge["callTool"]): HostBridge {
  return {
    callTool,
    sendFollowup: vi.fn(),
    openExternal: vi.fn(),
    getWidgetData: () => null,
  }
}

/** The locale the tree reads AND the date the shared formatter renders, in one line. */
function LocaleProbe() {
  return <p data-testid="locale">{`${useLocale()}|${formatTimestamp(ISO)}`}</p>
}

const NO_HOST: ShellHost = { connected: true, displayMode: "inline", availableDisplayModes: [] }

interface GateOptions {
  host?: Partial<ShellHost>
  waitMs?: number
}

function gateTree(callTool: HostBridge["callTool"], options: GateOptions = {}) {
  return (
    <ShellHostProvider host={{ ...NO_HOST, ...options.host }}>
      <HostBridgeProvider bridge={bridgeWith(callTool)}>
        <ProfileGate profileWaitMs={options.waitMs}>
          <LocaleProbe />
        </ProfileGate>
      </HostBridgeProvider>
    </ShellHostProvider>
  )
}

function renderGate(callTool: HostBridge["callTool"], options: GateOptions = {}) {
  return render(gateTree(callTool, options))
}

const neverAnswers = () => new Promise<never>(() => {})

/** `en|<date in en>` — what the probe shows for a locale (and optional zone). */
function probeFor(locale: string, timeZone?: string): string {
  return `${locale.split("-")[0]}|${new Date(ISO).toLocaleString(locale, timeZone ? { timeZone } : {})}`
}

const probe = () => screen.getByTestId("locale").textContent

function stubOsPreference(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
}

const isDark = () => document.documentElement.classList.contains("dark")

const gateQueryStatus = () => queryClient.getQueryState([...SHELL_SETTINGS_KEY, {}])?.status

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  // The query client is a module singleton on PRODUCTION defaults; cancel stops pending retries.
  await queryClient.cancelQueries()
  queryClient.clear()
  setFormatLocale(undefined)
  const root = document.documentElement
  root.className = ""
  root.lang = ""
  root.removeAttribute("data-theme")
  root.removeAttribute("style")
  vi.unstubAllGlobals()
})

describe("ProfileGate", () => {
  it("fetches the profile feed through the host bridge, with no arguments", async () => {
    const callTool = vi.fn().mockResolvedValue(feedResult({ language: "en" }))
    renderGate(callTool)

    await waitFor(() => expect(callTool).toHaveBeenCalledWith(FEED, {}))
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("provides the profile locale to the tree, the formatters and the document", async () => {
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "de" })))

    await waitFor(() => expect(probe()).toBe(probeFor("de")))
    expect(document.documentElement.lang).toBe("de")
  })

  it("holds the first paint while the profile loads — a localized skeleton, never English content", () => {
    renderGate(neverAnswers, { host: { locale: "de-DE" } })

    expect(screen.queryByTestId("locale")).toBeNull()
    // The placeholder speaks the host's language already.
    expect(screen.getByRole("status").textContent).toBe("Wird geladen…")
    expect(document.documentElement.lang).toBe("de")
  })

  it("paints nothing at all until the host bridge is connected", () => {
    renderGate(neverAnswers, { host: { connected: false } })

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByTestId("locale")).toBeNull()
  })

  it("renders from the host context once the bounded wait is over", async () => {
    renderGate(neverAnswers, { host: { locale: "de-AT" }, waitMs: 20 })

    await waitFor(() => expect(probe()).toBe(probeFor("de-AT")))
  })

  it("counts the profile wait from the host connection — a slow handshake never paints without the host context", () => {
    vi.useFakeTimers()
    // Before the handshake the host context is unknown.
    const view = renderGate(neverAnswers, { host: { connected: false }, waitMs: 100 })

    // No handshake: painting now would render English and the OS theme, then flip.
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.queryByTestId("locale")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()

    view.rerender(
      gateTree(neverAnswers, { host: { connected: true, locale: "de-DE" }, waitMs: 100 }),
    )
    // Connected: the profile gets its FULL bound behind the localized skeleton …
    expect(screen.getByRole("status").textContent).toBe("Wird geladen…")
    act(() => {
      vi.advanceTimersByTime(99)
    })
    expect(screen.queryByTestId("locale")).toBeNull()
    // … then the view paints from the host context.
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(probe()).toBe(probeFor("de-DE"))
  })

  it("paints without any host context only when the host never connects, after its own longer bound", () => {
    vi.useFakeTimers()
    renderGate(neverAnswers, { host: { connected: false }, waitMs: 100 })

    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(screen.queryByTestId("locale")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(probe()).toBe(probeFor("en"))
  })

  it("follows the host locale for a system profile, normalized to a shipped language", async () => {
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "system" })), {
      host: { locale: "de-AT", timeZone: "Asia/Tokyo" },
    })
    await waitFor(() => expect(probe()).toBe(probeFor("de-AT", "Asia/Tokyo")))
    expect(document.documentElement.lang).toBe("de")

    cleanup()
    queryClient.clear()
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "system" })), {
      host: { locale: "fr-FR" },
    })
    await waitFor(() => expect(probe()).toBe(probeFor("en")))
  })

  it("an explicit profile language beats the host locale", async () => {
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "en" })), {
      host: { locale: "de-DE" },
    })

    // English strings AND English dates — not the host's German conventions.
    await waitFor(() => expect(probe()).toBe(probeFor("en")))
    expect(document.documentElement.lang).toBe("en")
  })

  it("ignores a time zone the runtime does not know instead of breaking every date", async () => {
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "en" })), {
      host: { timeZone: "Mars/Olympus_Mons" },
    })

    await waitFor(() => expect(probe()).toBe(probeFor("en")))
  })

  it("never takes the theme from the profile: a stored theme of an earlier build is ignored", async () => {
    // No in-app theme switch: the host decides, then the OS.
    stubOsPreference(false)
    renderGate(vi.fn().mockResolvedValue(feedResult({ theme: "dark" })), {
      host: { theme: "light" },
    })
    await waitFor(() => expect(probe()).not.toBeNull())
    expect(isDark()).toBe(false)

    cleanup()
    queryClient.clear()
    stubOsPreference(false)
    renderGate(vi.fn().mockResolvedValue(feedResult({ theme: "light" })), {
      host: { theme: "dark" },
    })
    await waitFor(() => expect(probe()).not.toBeNull())
    expect(isDark()).toBe(true)
  })

  it("follows the HOST theme, even against the OS", async () => {
    stubOsPreference(false)
    renderGate(vi.fn().mockResolvedValue(feedResult({ language: "system" })), {
      host: { theme: "dark" },
    })

    await waitFor(() => expect(probe()).not.toBeNull())
    expect(isDark()).toBe(true)
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("falls back to the host locale and the OS theme at the feed's FIRST failure (e.g. the module is disabled)", async () => {
    stubOsPreference(true)
    const callTool = vi.fn().mockRejectedValue(new Error("unknown tool"))
    // A bound far beyond the test: only the failure itself can release the gate.
    renderGate(callTool, { host: { locale: "de-DE" }, waitMs: 60_000 })

    await waitFor(() => expect(probe()).toBe(probeFor("de-DE")))
    expect(isDark()).toBe(true)
    // react-query keeps the query PENDING through its retries; the view did not wait.
    expect(gateQueryStatus()).toBe("pending")
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it("applies a profile that a background retry delivers after the release", async () => {
    const callTool = vi
      .fn()
      .mockRejectedValueOnce(new Error("store briefly unavailable"))
      .mockResolvedValue(feedResult({ language: "en" }))
    renderGate(callTool, { host: { locale: "de-DE" }, waitMs: 60_000 })
    await waitFor(() => expect(probe()).toBe(probeFor("de-DE")))

    // react-query's first retry fires after 1 s; the tree stays mounted and flips.
    await waitFor(() => expect(probe()).toBe(probeFor("en")), { timeout: 3_000 })
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("flips live when the language section's save invalidates the shared key — no skeleton in between", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce(feedResult({ language: "en" }))
      .mockResolvedValue(feedResult({ language: "de" }))
    renderGate(callTool)
    await waitFor(() => expect(probe()).toBe(probeFor("en")))
    const shown = screen.getByTestId("locale")

    // What the shell's language section does after shell_save_settings.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: [...SHELL_SETTINGS_KEY] })
    })

    await waitFor(() => expect(probe()).toBe(probeFor("de")))
    expect(callTool).toHaveBeenCalledTimes(2)
    // The same node: the tree was never swapped for the first-paint skeleton.
    expect(screen.getByTestId("locale")).toBe(shown)
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("reads the shell's feed under the key the language section shares", async () => {
    const callTool = vi.fn().mockResolvedValue(feedResult({ language: "de" }))
    renderGate(callTool)

    await waitFor(() => expect(probe()).toBe(probeFor("de")))
    expect(callTool).toHaveBeenCalledWith(SHELL_SETTINGS_DATA, {})
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0])
    expect(keys).toEqual([SHELL_SETTINGS_KEY[0]])
  })
})
