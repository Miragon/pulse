// @vitest-environment happy-dom
import { act, useEffect, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserViewHost, type BrowserHostOptions } from "./browser-view-host.js"
import { useDisplayModeControl } from "./display-mode-toggle.js"
import { NO_INLINE_BUDGET, useInlineBudget } from "./inline-budget.js"
import { useShellHost } from "./shell-host.js"
import {
  HostModelContext,
  useHostLocation,
  useHostWrites,
  useStartPage,
  useViewHost,
  type ViewLocation,
} from "./view-host.js"
import { useHostDisplayMode } from "./widget-shell.js"

/**
 * The browser adapter over a plain document: what it hands the host-agnostic contexts a widget
 * reads on a page outside a chat (the page's theme and locale, its one display mode, the caller
 * the page hands in) and what it does not do (post to a chat, tell a model).
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let reactRoot: Root | undefined
const seen: {
  shell?: ReturnType<typeof useShellHost>
  host?: ReturnType<typeof useViewHost>
  control?: ReturnType<typeof useDisplayModeControl>
  budget?: ReturnType<typeof useInlineBudget>
  mode?: string
} = {}

function Probe() {
  const shell = useShellHost()
  const host = useViewHost()
  const control = useDisplayModeControl()
  const budget = useInlineBudget()
  const mode = useHostDisplayMode()
  useEffect(() => {
    Object.assign(seen, { shell, host, control, budget, mode })
  })
  return null
}

const NO_TOOLS = () => Promise.reject(new Error("no tools on this page"))

async function render(options: Partial<BrowserHostOptions> = {}, children: ReactNode = <Probe />) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  reactRoot = createRoot(container)
  await act(async () => {
    reactRoot!.render(
      <BrowserViewHost options={{ callTool: NO_TOOLS, ...options }}>{children}</BrowserViewHost>,
    )
  })
  return container
}

afterEach(async () => {
  await act(async () => reactRoot?.unmount())
  reactRoot = undefined
  for (const key of Object.keys(seen)) delete seen[key as keyof typeof seen]
  document.documentElement.removeAttribute("data-cd-theme")
  document.documentElement.lang = ""
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("BrowserViewHost: the page as the host", () => {
  it("is connected at once and owns its viewport: fullscreen, no switch, no inline budget", async () => {
    await render({ publicBase: "https://pulse.example" })
    expect(seen.shell).toMatchObject({
      connected: true,
      displayMode: "fullscreen",
      availableDisplayModes: ["fullscreen"],
      publicBase: "https://pulse.example",
    })
    expect(seen.shell?.styleVariables).toBeUndefined()
    expect(seen.shell?.fontCss).toBeUndefined()
    expect(seen.mode).toBe("fullscreen")
    expect(seen.control?.canFullscreen).toBe(false)
    expect(seen.budget).toBe(NO_INLINE_BUDGET)
    // Nothing to switch: a request changes nothing.
    act(() => seen.control?.request("inline"))
    expect(seen.mode).toBe("fullscreen")
  })

  it("follows the theme the page sets on data-cd-theme, else leaves it to the OS", async () => {
    await render()
    expect(seen.shell?.theme).toBeUndefined()
    await act(async () => document.documentElement.setAttribute("data-cd-theme", "dark"))
    expect(seen.shell?.theme).toBe("dark")
    await act(async () => document.documentElement.setAttribute("data-cd-theme", "light"))
    expect(seen.shell?.theme).toBe("light")
    await act(async () => document.documentElement.setAttribute("data-cd-theme", "night"))
    expect(seen.shell?.theme).toBeUndefined()
  })

  it("takes the page's locale: the option, else the document's lang, else the browser's", async () => {
    document.documentElement.lang = "de-AT"
    await render({ locale: "en-GB" })
    expect(seen.shell?.locale).toBe("en-GB")
    await act(async () => reactRoot?.unmount())
    await render()
    expect(seen.shell?.locale).toBe("de-AT")
    await act(async () => reactRoot?.unmount())
    document.documentElement.lang = ""
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-CH")
    await render()
    expect(seen.shell?.locale).toBe("de-CH")
  })
})

describe("BrowserViewHost: rendered on a server", () => {
  it("states no theme, so the page's own takes over once it hydrates", () => {
    function ThemeProbe() {
      return <output>{useShellHost().theme ?? "none"}</output>
    }
    document.documentElement.setAttribute("data-cd-theme", "dark")
    const html = renderToString(
      <BrowserViewHost options={{ callTool: NO_TOOLS }}>
        <ThemeProbe />
      </BrowserViewHost>,
    )
    expect(html).toBe("<output>none</output>")
  })
})

describe("BrowserViewHost: what a widget asks the page", () => {
  it("calls a tool through the page's caller; a throw is a transport failure", async () => {
    const result = { structuredContent: { n: 1 }, content: [] }
    const callTool = vi.fn((name: string) => {
      if (name === "broken") throw new Error("connection lost")
      return Promise.resolve(result)
    })
    await render({ callTool })
    expect(await seen.host?.callTool("a_data", { id: "x" })).toBe(result)
    expect(callTool).toHaveBeenCalledWith("a_data", { id: "x" })
    expect(await seen.host?.callTool("b_data")).toBe(result)
    expect(callTool).toHaveBeenLastCalledWith("b_data", {})
    await expect(seen.host?.callTool("broken")).rejects.toThrow("connection lost")
  })

  it("opens a link in a new tab, without an opener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    await render()
    seen.host?.openExternal("https://engine.example/cockpit")
    expect(open).toHaveBeenCalledWith(
      "https://engine.example/cockpit",
      "_blank",
      "noopener,noreferrer",
    )
  })

  it("posts to no chat: hand-offs hide unless the page copies them", async () => {
    await render()
    expect(seen.host?.followUp).toBe("none")
    expect(() => seen.host?.sendFollowUp("Explain this.")).not.toThrow()
    await act(async () => reactRoot?.unmount())
    await render({ followUp: "copy" })
    expect(seen.host?.followUp).toBe("copy")
  })

  it("names the page's start page where the page has one, none otherwise", async () => {
    function StartPageProbe() {
      return <output>{useStartPage() ?? "none"}</output>
    }
    const without = await render({}, <StartPageProbe />)
    expect(without.textContent).toBe("none")
    await act(async () => reactRoot?.unmount())
    const container = await render({ startPage: "/app" }, <StartPageProbe />)
    expect(container.textContent).toBe("/app")
  })

  it("keeps no address of its own: a page's view gets one where the page shows it", async () => {
    const seenLocation: Array<ViewLocation | undefined> = []
    function LocationProbe() {
      const location = useHostLocation()
      useEffect(() => {
        seenLocation.push(location)
      })
      return null
    }
    await render(
      { startPage: "/app" },
      <>
        <Probe />
        <LocationProbe />
      </>,
    )
    expect(seenLocation.at(-1)).toBeUndefined()
    expect(seen.host).not.toHaveProperty("location")
  })

  it("offers no write: a page writes to no engine", async () => {
    await render()
    expect(seen.host?.writes).toBe(false)
    function WritesProbe() {
      return <output>{String(useHostWrites())}</output>
    }
    await act(async () => reactRoot?.unmount())
    const container = await render({ followUp: "copy" }, <WritesProbe />)
    expect(container.textContent).toBe("false")
  })

  it("tells no model anything, and still renders what a model context wraps", async () => {
    const container = await render(
      {},
      <HostModelContext content="Probe view.">
        <output>rows</output>
      </HostModelContext>,
    )
    expect(container.textContent).toBe("rows")
  })
})
