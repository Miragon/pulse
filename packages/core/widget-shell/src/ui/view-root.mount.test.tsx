// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"
import { VIEW_NAME_GLOBAL } from "../view-name.js"
import { installCallObserver } from "./call-observer.js"
import { SHELL_VIEW_CONFIG } from "./display-mode-toggle.js"
import { mountView, mountViews, ViewRoot, type MountViewOptions } from "./view-root.js"
import type { ViewComponent } from "./views.js"

const bootstrap = vi.hoisted(() => vi.fn())
vi.mock("mcp-use/react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bootstrapView: bootstrap,
}))

const global = globalThis as Record<string, unknown>
const Rows: ViewComponent = () => null
const Other: ViewComponent = () => null
const hostWidgets = { "demo:panel": () => null }

/** The element `bootstrapView` would render, with its props. */
function mounted(): ReactElement<MountViewOptions & { observer: unknown }> {
  const module = bootstrap.mock.calls.at(-1)?.[0] as { default: () => ReactElement }
  return module.default() as ReactElement<MountViewOptions & { observer: unknown }>
}

afterEach(() => {
  bootstrap.mockReset()
  delete global[VIEW_NAME_GLOBAL]
  vi.restoreAllMocks()
})

describe("mountViews", () => {
  it("mounts the view the document's prelude names, with the shell's display modes", () => {
    global[VIEW_NAME_GLOBAL] = "demo_show_rows"
    mountViews({ views: { demo_show_rows: Rows, demo_show_other: Other }, hostWidgets })
    expect(bootstrap).toHaveBeenCalledOnce()
    expect(bootstrap.mock.calls[0]?.[0]).toMatchObject({ viewConfig: SHELL_VIEW_CONFIG })
    const element = mounted()
    expect(element.type).toBe(ViewRoot)
    expect(element.props).toMatchObject({ name: "demo_show_rows", view: Rows, hostWidgets })
  })

  it("mounts no view for a name the map lacks, or without a prelude — never an inherited key", () => {
    global[VIEW_NAME_GLOBAL] = "toString"
    mountViews({ views: { demo_show_rows: Rows } })
    expect(mounted().props).toMatchObject({ name: "toString", view: undefined })

    delete global[VIEW_NAME_GLOBAL]
    mountViews({ views: { demo_show_rows: Rows } })
    expect(mounted().props).toMatchObject({ name: undefined, view: undefined })
  })
})

describe("mountView", () => {
  it("installs the call observer BEFORE the runtime connects, and hands it to the root", () => {
    const parent = {} as Window
    vi.spyOn(window, "parent", "get").mockReturnValue(parent)
    let observedBefore: unknown = "not called"
    bootstrap.mockImplementation(() => {
      observedBefore = installCallObserver()
    })
    mountView({ name: "demo_show_rows", view: Rows })
    expect(observedBefore).not.toBeNull()
    expect(mounted().props.observer).toBe(observedBefore)
  })
})
