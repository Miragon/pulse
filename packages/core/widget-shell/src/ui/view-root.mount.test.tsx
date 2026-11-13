// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactElement } from "react"
import { VIEW_NAME_GLOBAL } from "../protocol/view-name.js"
import { SHELL_VIEW_CONFIG } from "./display-mode-toggle.js"
import { mountViews, ViewRoot, type MountViewOptions } from "./view-root.js"
import type { ViewRuntime } from "./view-runtime.js"
import type { ViewComponent } from "./views.js"

const { render, create } = vi.hoisted(() => ({
  render: vi.fn(),
  create: vi.fn((): unknown => ({ connect: () => Promise.resolve() })),
}))
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }))
vi.mock("./view-runtime.js", () => ({ createViewRuntime: create }))

const global = globalThis as Record<string, unknown>
const Rows: ViewComponent = () => null
const Other: ViewComponent = () => null

/** The root the document renders under its error boundary, with its props. */
function mounted(): ReactElement<MountViewOptions & { runtime: ViewRuntime }> {
  const boundary = render.mock.calls.at(-1)?.[0] as ReactElement<{ children: ReactElement }>
  return boundary.props.children as ReactElement<MountViewOptions & { runtime: ViewRuntime }>
}

afterEach(() => {
  render.mockClear()
  create.mockClear()
  delete global[VIEW_NAME_GLOBAL]
  vi.restoreAllMocks()
})

describe("mountViews", () => {
  it("mounts the view the document's prelude names, with the shell's display modes", () => {
    global[VIEW_NAME_GLOBAL] = "demo_show_rows"
    mountViews({ views: { demo_show_rows: Rows, demo_show_other: Other } })
    expect(render).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith(SHELL_VIEW_CONFIG)
    const element = mounted()
    expect(element.type).toBe(ViewRoot)
    expect(element.props).toMatchObject({ name: "demo_show_rows", view: Rows })
  })

  it("takes the view map alone: no module renders another's widget, so there is no host widget map", () => {
    global[VIEW_NAME_GLOBAL] = "demo_show_rows"
    // @ts-expect-error: the root takes no host widget map
    mountViews({ views: { demo_show_rows: Rows }, hostWidgets: { "demo:panel": () => null } })
    expect(Object.keys(mounted().props).sort()).toEqual(["name", "runtime", "view"])
  })

  it("mounts no view for a name the map lacks, or without a prelude; never an inherited key", () => {
    global[VIEW_NAME_GLOBAL] = "toString"
    mountViews({ views: { demo_show_rows: Rows } })
    expect(mounted().props).toMatchObject({ name: "toString", view: undefined })

    delete global[VIEW_NAME_GLOBAL]
    mountViews({ views: { demo_show_rows: Rows } })
    expect(mounted().props).toMatchObject({ name: undefined, view: undefined })
  })
})
