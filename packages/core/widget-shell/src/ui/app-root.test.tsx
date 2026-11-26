// @vitest-environment happy-dom
import { act, useEffect, useState, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getFormatLocale, useLocale } from "@miragon/pulse-ui"
import type { ToolResult } from "../protocol/tool-result.js"
import { mountApp } from "./app-root.js"
import type { ToolCaller } from "./browser-view-host.js"
import { mountPage } from "./page-root.js"
import { PageView } from "./page-view.js"
import { createTestQueryClient } from "./test-view-host.js"
import { useQueryClient, useToolQuery, type QueryClient } from "./tool-query.js"
import {
  useHostChrome,
  useHostLocation,
  useViewHost,
  type HostChrome,
  type ViewLocation,
} from "./view-host.js"
import type { ViewComponent, ViewMap } from "./views.js"

/**
 * A page's own app outside a chat (`mountApp`) and the views it shows where it wants them
 * (`PageView`): the app runs under the browser adapter and the providers every root shares, calls
 * no tool itself, and each view calls its view tool through the page's caller, at the address the
 * page keeps for it.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEW_TOOL = "demo_show_rows"

const result = (data: unknown): ToolResult => ({
  content: [{ type: "text", text: "Rows." }],
  structuredContent: data,
})

/** Its data, a feed it reads itself (the app reads the same one) and the address it was given. */
const RowsView: ViewComponent<{ rows: string[] }> = ({ data }) => {
  const feed = useToolQuery<{ total: number }>(["demo"], "demo_rows_data", {})
  const location = useHostLocation()
  const [clicks, setClicks] = useState(0)
  return (
    <main>
      <output data-testid="view">
        {`${data.rows.join(",")}|${String(feed.data?.total)}|${location ? "located" : "none"}`}
      </output>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        {`clicked ${String(clicks)}`}
      </button>
    </main>
  )
}

const VIEWS: ViewMap = { [VIEW_TOOL]: RowsView as ViewComponent }

/** The page's caller over fake tools: the view tool answers with the rows its arguments name. */
function stubCaller() {
  return vi.fn<ToolCaller>((name, args) => {
    const rows = typeof args.rows === "string" ? args.rows : "a"
    if (name === VIEW_TOOL) return Promise.resolve(result({ rows: [rows] }))
    if (name === "demo_rows_data") return Promise.resolve(result({ total: 2 }))
    return Promise.reject(new Error(`Tool ${name} not found`))
  })
}

const viewCalls = (callTool: ReturnType<typeof stubCaller>) =>
  callTool.mock.calls.filter(([name]) => name === VIEW_TOOL).map(([, args]) => args)

let unmount: (() => void) | undefined

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Mounts `App` with `options` in a container of its own. */
async function mount(App: () => ReactNode, options: Parameters<typeof mountApp>[1] = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = mountApp(App, { container, ...options })
  })
  await settled()
  return container
}

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.documentElement.lang = ""
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("style")
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The OS prefers dark: a page that writes its theme would write dark. */
function stubDarkOs(): void {
  const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(query))
}

describe("mountApp", () => {
  it("renders the page's app under the view's providers and calls no tool itself", async () => {
    const callTool = stubCaller()
    const App = () => <p data-testid="app">{`${useLocale()}|${String(useViewHost().writes)}`}</p>
    const container = await mount(App, { callTool, locale: "de-DE" })
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("de|false")
    expect(callTool).not.toHaveBeenCalled()
  })

  it("refuses a tool its app asks for where the page hands no caller", async () => {
    let asked: Promise<unknown> | undefined
    const App = () => {
      const { callTool } = useViewHost()
      asked ??= callTool("demo_rows_data").catch((error: unknown) => error)
      return <p>alone</p>
    }
    await mount(App)
    expect(String(await asked)).toBe("Error: This page shows no view, so it calls no tool.")
  })

  it("mounts into the document's #root, creating it where the page has none", async () => {
    await act(async () => {
      unmount = mountApp(() => <p>in the root</p>)
    })
    expect(document.getElementById("root")?.textContent).toBe("in the root")
  })

  it("gives the page the query client it hands in, its reads in that client's cache", async () => {
    const client = createTestQueryClient()
    const seen: QueryClient[] = []
    const App = () => {
      const own = useQueryClient()
      useEffect(() => {
        seen.push(own)
      }, [own])
      const feed = useToolQuery<{ total: number }>(["demo"], "demo_rows_data", {})
      return <p data-testid="app">{String(feed.data?.total)}</p>
    }
    const container = await mount(App, { callTool: stubCaller(), client, locale: "en" })
    expect(new Set(seen)).toEqual(new Set([client]))
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("2")
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })

  it("keeps a document's own theme: a stamped data-theme stays, an unstamped root stays bare", async () => {
    stubDarkOs()
    const root = document.documentElement
    const changed: Array<string | null> = []
    const observer = new MutationObserver((records) => {
      changed.push(...records.map((record) => record.attributeName))
    })
    /** Every attribute written to the root since the last ask. */
    const writes = () => {
      const seen = [...changed, ...observer.takeRecords().map((record) => record.attributeName)]
      changed.length = 0
      return seen
    }
    root.setAttribute("data-theme", "light")
    // The page's fill writes the root's height; its theme is data-theme, the class and color-scheme.
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] })
    const App = () => <p data-testid="app">themed</p>
    const container = await mount(App, { documentTheme: true, locale: "en" })
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("themed")
    expect(root.getAttribute("data-theme")).toBe("light")
    expect(root.classList.contains("dark")).toBe(false)
    expect(root.style.getPropertyValue("color-scheme")).toBe("")
    // The host switches to dark: followed, still unwritten.
    await act(async () => root.setAttribute("data-theme", "dark"))
    expect(root.classList.contains("dark")).toBe(false)
    expect(writes()).toEqual(["data-theme"])
    await act(async () => unmount?.())

    root.removeAttribute("data-theme")
    await mount(App, { documentTheme: true, locale: "en" })
    expect(root.hasAttribute("data-theme")).toBe(false)
    expect(writes()).toEqual(["data-theme"])
    observer.disconnect()
  })

  it("renders the page's dates in the time zone it names, the browser's for one it does not know", async () => {
    const App = () => <p data-testid="app">{getFormatLocale()?.timeZone ?? "own"}</p>
    const container = await mount(App, { timeZone: "Asia/Tokyo", locale: "en" })
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("Asia/Tokyo")
    await act(async () => unmount?.())
    const unknown = await mount(App, { timeZone: "Mars/Olympus", locale: "en" })
    expect(unknown.querySelector('[data-testid="app"]')?.textContent).toBe("own")
  })
})

describe("PageView", () => {
  it("shows a view in the app, called once with its arguments, its reads in the app's cache", async () => {
    const callTool = stubCaller()
    const App = () => {
      const feed = useToolQuery<{ total: number }>(["demo"], "demo_rows_data", {})
      return (
        <>
          <p data-testid="app">{String(feed.data?.total)}</p>
          <PageView views={VIEWS} view={VIEW_TOOL} args={{ rows: "x" }} />
        </>
      )
    }
    const container = await mount(App, { callTool, locale: "en" })
    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe("x|2|none")
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("2")
    // StrictMode runs the effect twice; the view tool is called once, the feed once for both.
    expect(viewCalls(callTool)).toEqual([{ rows: "x" }])
    expect(callTool.mock.calls.filter(([name]) => name === "demo_rows_data")).toHaveLength(1)
    // In the app's layout the view takes its content's height.
    const main = container.querySelector<HTMLElement>('[data-slot="view-frame"] > main')
    expect(main?.style.minHeight).toBe("")
  })

  it("starts anew at other arguments, and keeps its state while they stay", async () => {
    const callTool = stubCaller()
    // The page's own state picks the arguments: buttons beside the view render it again.
    const App = () => {
      const [rows, setRows] = useState("a")
      const [renders, setRenders] = useState(0)
      return (
        <>
          <PageView views={VIEWS} view={VIEW_TOOL} args={{ rows }} />
          <button type="button" data-testid="same" onClick={() => setRenders(renders + 1)}>
            {`same ${String(renders)}`}
          </button>
          <button type="button" data-testid="next" onClick={() => setRows("b")}>
            next
          </button>
        </>
      )
    }
    const container = await mount(App, { callTool, locale: "en" })
    const button = () => container.querySelector("main button")
    const press = async (id: string) => {
      await act(async () => container.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.click())
      await settled()
    }
    await act(async () => container.querySelector<HTMLElement>("main button")?.click())
    expect(button()?.textContent).toBe("clicked 1")
    // A new render with the same arguments keeps the view as it is.
    await press("same")
    expect(container.querySelector('[data-testid="same"]')?.textContent).toBe("same 1")
    expect(button()?.textContent).toBe("clicked 1")
    await press("next")
    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe("b|2|none")
    expect(button()?.textContent).toBe("clicked 0")
    expect(viewCalls(callTool)).toEqual([{ rows: "a" }, { rows: "b" }])
  })

  it("gives the view the page's address for it, and the app beside it none", async () => {
    const location: ViewLocation = { report: vi.fn(), subscribe: () => () => undefined }
    const App = () => (
      <>
        <p data-testid="app">{useHostLocation() ? "located" : "none"}</p>
        <PageView views={VIEWS} view={VIEW_TOOL} location={location} />
      </>
    )
    const container = await mount(App, { callTool: stubCaller(), locale: "en" })
    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe("a|2|located")
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("none")
  })

  it("gives the view the page's chrome, its address kept, and the app beside it none", async () => {
    const location: ViewLocation = { report: vi.fn(), subscribe: () => () => undefined }
    const chrome: HostChrome = { menu: <button type="button">Menu</button> }
    /** What a view reads of the page around it: its chrome's menu and its address. */
    const Chromed: ViewComponent = () => {
      const seen = useHostChrome()
      return (
        <main data-testid="view">
          {seen?.menu}
          {useHostLocation() ? "located" : "none"}
        </main>
      )
    }
    const App = () => (
      <>
        <p data-testid="app">{useHostChrome() ? "chrome" : "none"}</p>
        <PageView views={{ [VIEW_TOOL]: Chromed }} view={VIEW_TOOL} chrome={chrome} />
        <PageView
          views={{ [VIEW_TOOL]: Chromed }}
          view={VIEW_TOOL}
          args={{ rows: "b" }}
          chrome={chrome}
          location={location}
        />
      </>
    )
    const container = await mount(App, { callTool: stubCaller(), locale: "en" })
    const views = [...container.querySelectorAll('[data-testid="view"]')]
    expect(views.map((view) => view.textContent)).toEqual(["Menunone", "Menulocated"])
    expect(container.querySelector('[data-testid="app"]')?.textContent).toBe("none")
  })

  it("names an unknown view and calls no tool for it", async () => {
    const callTool = stubCaller()
    const App = () => <PageView views={VIEWS} view="hasOwnProperty" />
    const container = await mount(App, { callTool, locale: "en" })
    expect(container.textContent).toContain("can't show this view")
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe("mountPage over the app root", () => {
  it("gives its view the page's address", async () => {
    const location: ViewLocation = { report: vi.fn(), subscribe: () => () => undefined }
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      unmount = mountPage(VIEWS, {
        view: VIEW_TOOL,
        callTool: stubCaller(),
        container,
        location,
        locale: "en",
      })
    })
    await settled()
    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe("a|2|located")
  })
})
