// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { useLocale, formatTimestamp, setFormatLocale } from "@miragon/pulse-ui"
import { LocaleGate } from "./locale-gate.js"
import type { ShellHost } from "./shell-host.js"
import { TestViewHost } from "./test-view-host.js"

const ISO = "2026-07-22T22:15:30.000Z"

/** The locale the tree reads AND the date the shared formatter renders, in one line. */
function LocaleProbe() {
  return <p data-testid="locale">{`${useLocale()}|${formatTimestamp(ISO)}`}</p>
}

function gateTree(host: Partial<ShellHost> = {}) {
  return (
    <TestViewHost host={host}>
      <LocaleGate>
        <LocaleProbe />
      </LocaleGate>
    </TestViewHost>
  )
}

function renderGate(host: Partial<ShellHost> = {}) {
  return render(gateTree(host))
}

/** `en|<date in en>`: what the probe shows for a locale (and optional zone). */
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setFormatLocale(undefined)
  const root = document.documentElement
  root.className = ""
  root.lang = ""
  root.removeAttribute("data-theme")
  root.removeAttribute("style")
  vi.unstubAllGlobals()
})

describe("LocaleGate", () => {
  it("provides the host locale to the tree, the formatters and the document", async () => {
    renderGate({ locale: "de-DE" })

    await waitFor(() => expect(probe()).toBe(probeFor("de-DE")))
    expect(document.documentElement.lang).toBe("de")
  })

  it("paints nothing at all until the host bridge is connected", () => {
    renderGate({ connected: false })

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByTestId("locale")).toBeNull()
  })

  it("renders at once when the host connects", () => {
    vi.useFakeTimers()
    const view = renderGate({ connected: false })
    expect(screen.queryByTestId("locale")).toBeNull()

    view.rerender(gateTree({ connected: true, locale: "de-DE" }))
    expect(probe()).toBe(probeFor("de-DE"))
  })

  it("paints without any host context only when the host never connects, after its own longer bound", () => {
    vi.useFakeTimers()
    renderGate({ connected: false })

    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(screen.queryByTestId("locale")).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(probe()).toBe(probeFor("en"))
  })

  it("follows the host locale, normalized to a shipped language", async () => {
    renderGate({ locale: "de-AT", timeZone: "Asia/Tokyo" })
    await waitFor(() => expect(probe()).toBe(probeFor("de-AT", "Asia/Tokyo")))
    expect(document.documentElement.lang).toBe("de")

    cleanup()
    renderGate({ locale: "fr-FR" })
    await waitFor(() => expect(probe()).toBe(probeFor("en")))
    expect(document.documentElement.lang).toBe("en")
  })

  it("ignores a time zone the runtime does not know instead of breaking every date", async () => {
    renderGate({ timeZone: "Mars/Olympus_Mons" })

    await waitFor(() => expect(probe()).toBe(probeFor("en")))
  })

  it("follows the HOST theme, even against the OS", async () => {
    stubOsPreference(false)
    renderGate({ theme: "dark" })

    await waitFor(() => expect(probe()).not.toBeNull())
    expect(isDark()).toBe(true)
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })
})
