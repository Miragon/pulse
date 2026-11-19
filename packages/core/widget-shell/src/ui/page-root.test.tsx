// @vitest-environment happy-dom
import { act, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useLocale } from "@miragon/pulse-ui"
import { askAiPrompt } from "./ask-ai-prompt.js"
import type { ToolResult } from "../protocol/tool-result.js"
import type { ToolCaller } from "./browser-view-host.js"
import { HandOffButton } from "./hand-off-button.js"
import { useToolQuery } from "./tool-query.js"
import { useViewHost } from "./view-host.js"
import { mountPage, type MountPageOptions } from "./page-root.js"
import type { ViewComponent, ViewMap } from "./views.js"
import { useHostDisplayMode } from "./widget-shell.js"

/**
 * One view on a page outside a chat: the page calls the view tool through its own caller, and the
 * view runs under the providers every root shares, so a widget's queries, words and hand-offs work
 * as in a chat, without ext-apps.
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VIEW_TOOL = "demo_show_rows"

const result = (data: unknown) => ({
  content: [{ type: "text" as const, text: "Two rows." }],
  structuredContent: data,
})

/** Its data, a feed it reads itself, the locale and display mode it renders in, and a hand-off. */
const RowsView: ViewComponent<{ rows: string[] }> = ({ data }) => {
  const feed = useToolQuery<{ total: number }>(["demo"], "demo_rows_data", {})
  return (
    <main>
      <output data-testid="probe">
        {`${useLocale()}|${useHostDisplayMode()}|${data.rows.join(",")}|${String(feed.data?.total)}`}
      </output>
      <HandOffButton
        action="assess"
        variant="toolbar"
        prompt={askAiPrompt({ intent: "Assess these rows.", locale: "en" })}
      />
    </main>
  )
}

const VIEWS: ViewMap = { [VIEW_TOOL]: RowsView as ViewComponent }

/** The page's caller over fake tools; a tool it lacks is a transport failure. */
function stubCaller(tools: Record<string, (args: Record<string, unknown>) => unknown>) {
  return vi.fn<ToolCaller>((name, args) => {
    const tool = tools[name]
    if (!tool) return Promise.reject(new Error(`Tool ${name} not found`))
    return Promise.resolve(tool(args) as ToolResult)
  })
}

const ROWS_TOOLS = {
  [VIEW_TOOL]: () => result({ rows: ["a", "b"] }),
  demo_rows_data: () => result({ total: 2 }),
}

let unmount: (() => void) | undefined

async function mount(options: Partial<MountPageOptions> & Pick<MountPageOptions, "callTool">) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = mountPage(VIEWS, { view: VIEW_TOOL, container, ...options })
  })
  return container
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.documentElement.removeAttribute("data-cd-theme")
  document.documentElement.removeAttribute("class")
  document.documentElement.lang = ""
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("mountPage", () => {
  it("shows the view with its tool's data, called ONCE through the page's caller", async () => {
    const callTool = stubCaller(ROWS_TOOLS)
    const container = await mount({ callTool, args: { engine: "prod" }, locale: "de-DE" })
    await settled()
    expect(container.querySelector("output")?.textContent).toBe("de|fullscreen|a,b|2")
    // StrictMode runs the effect twice; the page still calls the view tool once.
    expect(callTool.mock.calls.filter(([name]) => name === VIEW_TOOL)).toEqual([
      [VIEW_TOOL, { engine: "prod" }],
    ])
    // A page owns its viewport: no fullscreen switch, no "Reloaded at" stamp.
    expect(container.querySelector('[data-slot="view-toolbar"]')).toBeNull()
  })

  it("hides the view's hand-offs unless the page copies them", async () => {
    const hidden = await mount({ callTool: stubCaller(ROWS_TOOLS), locale: "en" })
    await settled()
    expect(hidden.querySelector("output")).not.toBeNull()
    expect(hidden.querySelector("button")).toBeNull()
    await act(async () => unmount?.())
    const copying = await mount({
      callTool: stubCaller(ROWS_TOOLS),
      followUp: "copy",
      locale: "en",
    })
    await settled()
    expect(copying.querySelector("button")?.getAttribute("title")).toBe(
      "Copy prompt: Assess in chat",
    )
  })

  it("follows the theme the page sets, and the OS without one", async () => {
    document.documentElement.setAttribute("data-cd-theme", "dark")
    await mount({ callTool: stubCaller(ROWS_TOOLS) })
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    await act(async () => document.documentElement.removeAttribute("data-cd-theme"))
    expect(document.documentElement.getAttribute("data-theme")).toBe("light")
  })

  it("shows a failed call in the frame with Try again, which calls the tool again", async () => {
    let calls = 0
    const callTool = stubCaller({
      [VIEW_TOOL]: () => {
        calls += 1
        return calls === 1
          ? { isError: true, content: [{ type: "text", text: "Engine unreachable." }] }
          : result({ rows: ["c"] })
      },
      demo_rows_data: () => result({ total: 1 }),
    })
    const container = await mount({ callTool, locale: "en" })
    await settled()
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    )
    expect(retry).toBeDefined()
    await act(async () => retry?.click())
    await settled()
    expect(container.querySelector("output")?.textContent).toBe("en|fullscreen|c|1")
  })

  // The cockpit keeps its head over a route that fails to read its engine: the page hands the view
  // data of its own for such a start, and the view says the failure in its place.
  it("shows the view with the data the page gives for a failed start, the frame's state without", async () => {
    const callTool = stubCaller({
      [VIEW_TOOL]: () => ({ isError: true, content: [{ type: "text", text: "[503] down" }] }),
      demo_rows_data: () => result({ total: 3 }),
    })
    const seen: string[] = []
    const failedStart = (error: Error) => {
      seen.push(error.message)
      return error.message.includes("503") ? { rows: ["failed"] } : null
    }
    const container = await mount({ callTool, locale: "en", failedStart })
    await settled()
    expect(container.querySelector("output")?.textContent).toBe("en|fullscreen|failed|3")
    expect(seen).toEqual(["[503] down"])
    expect(container.textContent).not.toContain("Try again")
    await act(async () => unmount?.())

    const refused = stubCaller({
      [VIEW_TOOL]: () => ({ isError: true, content: [{ type: "text", text: "refused" }] }),
    })
    const framed = await mount({ callTool: refused, locale: "en", failedStart })
    await settled()
    expect(framed.querySelector("output")).toBeNull()
    expect(framed.textContent).toContain("Try again")
  })

  it("shows a caller's rejection, a transport failure, in the frame's words", async () => {
    const callTool = vi.fn<ToolCaller>(() => Promise.reject(new Error("fetch failed")))
    const container = await mount({ callTool, locale: "en" })
    await settled()
    expect(container.querySelector("output")).toBeNull()
    expect(container.textContent).toContain("The data source is unreachable")
  })

  it("treats a result without view data as a failure, never as an empty view", async () => {
    const callTool = stubCaller({ [VIEW_TOOL]: () => result(["not", "a", "view"]) })
    const container = await mount({ callTool, locale: "en" })
    await settled()
    expect(container.querySelector("output")).toBeNull()
    expect(container.textContent).toContain("This view couldn't be loaded")
  })

  it("names an unknown view, an inherited key included, and calls no tool for it", async () => {
    const callTool = stubCaller(ROWS_TOOLS)
    const container = await mount({ callTool, view: "toString", locale: "en" })
    await settled()
    expect(container.textContent).toContain("can't show this view")
    expect(callTool).not.toHaveBeenCalled()
  })

  it("renders the page's frame around the view under the view's providers", async () => {
    const Frame = ({ children }: { children?: ReactNode }) => (
      <div data-testid="frame">
        <p data-testid="frame-locale">{useLocale()}</p>
        {children}
      </div>
    )
    const callTool = stubCaller(ROWS_TOOLS)
    const container = await mount({ callTool, frame: Frame, locale: "de" })
    await settled()
    expect(container.querySelector('[data-testid="frame-locale"]')?.textContent).toBe("de")
    const main = container.querySelector('[data-testid="frame"] main')
    expect(main?.querySelector("output")?.textContent).toBe("de|fullscreen|a,b|2")
    // The frame lays out the page: the view takes its content's height, not the viewport's.
    const frameMain = container.querySelector<HTMLElement>('[data-testid="frame"] > div > main')
    expect(frameMain?.style.minHeight).toBe("")
    expect(frameMain?.style.overflowY).toBe("")
  })

  it("shows a frame alone where the page names no view, and calls no tool", async () => {
    const Frame = ({ children }: { children?: ReactNode }) => {
      const locale = useLocale()
      return <p data-testid="frame">{children ?? `alone|${locale}`}</p>
    }
    const callTool = stubCaller(ROWS_TOOLS)
    const container = await mount({ callTool, frame: Frame, view: undefined, locale: "en" })
    await settled()
    expect(container.querySelector('[data-testid="frame"]')?.textContent).toBe("alone|en")
    expect(callTool).not.toHaveBeenCalled()
  })

  it("shows a frame alone without a caller, and refuses a tool its frame asks for", async () => {
    let asked: Promise<unknown> | undefined
    const Frame = () => {
      const { callTool } = useViewHost()
      asked ??= callTool("demo_rows_data").catch((error: unknown) => error)
      return <p data-testid="frame">{useLocale()}</p>
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      unmount = mountPage(VIEWS, { container, frame: Frame, locale: "de" })
    })
    await settled()
    expect(container.querySelector('[data-testid="frame"]')?.textContent).toBe("de")
    expect(container.querySelector("main")).toBeNull()
    expect(String(await asked)).toBe("Error: This page shows no view, so it calls no tool.")
  })

  it("fills the viewport without a frame, as a chat's fullscreen view does", async () => {
    const container = await mount({ callTool: stubCaller(ROWS_TOOLS), locale: "en" })
    await settled()
    const main = container.querySelector<HTMLElement>('[data-slot="view-frame"] > main')
    expect(main?.style.minHeight).toBe("100vh")
  })

  it("names the missing view without a frame and without a view name", async () => {
    const callTool = stubCaller(ROWS_TOOLS)
    const container = await mount({ callTool, view: undefined, locale: "en" })
    await settled()
    expect(container.textContent).toContain("can't show this view")
    expect(callTool).not.toHaveBeenCalled()
  })

  it("mounts into the document's #root, creating it where the page has none", async () => {
    await act(async () => {
      unmount = mountPage(VIEWS, { view: VIEW_TOOL, callTool: stubCaller(ROWS_TOOLS) })
    })
    await settled()
    const root = document.getElementById("root")
    expect(root?.querySelector("output")?.textContent).toContain("a,b")
    await act(async () => unmount?.())
    unmount = undefined
    expect(root?.textContent).toBe("")
  })
})
