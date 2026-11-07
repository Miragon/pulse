import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Tool } from "@modelcontextprotocol/client"
import { engineModule } from "@miragon/pulse-engine-connector"
import { ENGINE_HOST_WIDGET_REFS } from "@miragon/pulse-engine-connector/widgets"
import { hostWidgets, viewRegistry } from "../src/ui/view-registry.js"
import {
  bootComposition,
  closeComposition,
  isBundleView,
  isComposed,
  isViewBound,
  toolsetSelections,
} from "./boot.js"

/**
 * The bundle picks a view by its name (= the view tool's name). Both halves
 * fail SILENTLY: a view-bound tool without a view renders the "can't show this
 * view" state, and a view no tool opens is dead code in every view's bundle.
 * The tools come from the REAL composition (`createApp`) on every toolset its
 * modules declare, so every module this server composes is covered without an
 * edit here. A view a module brings itself is not in the bundle, so the registry
 * asks nothing of it (the boot refuses its tool when no module registers its
 * resource); its tool is still held to being a read.
 */
describe("the view registry vs the view-bound tools", () => {
  const selections = toolsetSelections()
  /** Every tool any toolset lists with a view from the bundle, by name. */
  const viewTools = new Map<string, Tool>()
  /** Those and the tools with a view of their module's own, by name. */
  const boundTools = new Map<string, Tool>()

  beforeAll(async () => {
    for (const selection of selections) {
      const booted = await bootComposition({ MCP_ACTIVE_MODULES: selection })
      try {
        for (const tool of booted.tools.filter(isBundleView)) viewTools.set(tool.name, tool)
        for (const tool of booted.tools.filter(isViewBound)) boundTools.set(tool.name, tool)
      } finally {
        await closeComposition(booted)
      }
    }
  }, 30_000 * selections.length)

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("holds a view for every view-bound tool", () => {
    const missing = [...viewTools.keys()].filter((name) => !(name in viewRegistry)).sort()
    expect(
      missing,
      "view-bound tools without a view: spread the module's view map (keyed by the tool's " +
        "name) into viewRegistry in src/ui/view-registry.ts",
    ).toEqual([])
  })

  it("holds no view that no tool opens", () => {
    const dead = Object.keys(viewRegistry)
      .filter((name) => !viewTools.has(name))
      .sort()
    expect(
      dead,
      "views no listed tool opens: key each view by its view tool's name, bind that tool to it " +
        "(showToolBinding), and drop the spread of a module that is no longer in MODULES from " +
        "src/ui/view-registry.ts",
    ).toEqual([])
  })

  it("asks only about views from the bundle, never about one a module brings itself", () => {
    const bound = (resourceUri: string) =>
      ({ name: "x", inputSchema: { type: "object" }, _meta: { ui: { resourceUri } } }) as Tool
    expect(isBundleView(bound("ui://views/x.html"))).toBe(true)
    expect(isBundleView(bound("ui://acme/board.html"))).toBe(false)
  })

  // On a host that strips `structuredContent` (claude.ai) the view re-runs its own view tool ONCE
  // by itself, with no annotation check: only a read may be re-run unasked. A tool with a view of
  // its module's own is no re-run, but it registers past the registrar's toolset filter, so it lists
  // on the read-only floor, where only a read belongs.
  it("binds a view to read-only tools only, since a stripped result re-runs the tool", () => {
    const writes = [...boundTools.values()]
      .filter(
        ({ annotations }) =>
          annotations?.readOnlyHint !== true || annotations.destructiveHint === true,
      )
      .map(({ name }) => name)
      .sort()
    expect(
      writes,
      "view-bound tools that are not reads: a host that strips structuredContent re-runs the " +
        "view tool once, unasked. Annotate it { readOnlyHint: true } and move the write into a " +
        "registrar tool of its own (create-module skill, Steps 4 and 5)",
    ).toEqual([])
  })
})

/**
 * The widgets one module renders of another by raw id (`<owner>:<widget>`); today only the engine
 * module renders any (`ENGINE_HOST_WIDGET_REFS`). One whose owner is not composed is dead code in
 * every view's bundle; one a composed module renders and its composed owner ships but the bundle
 * lacks leaves the slot to the caller's fallback.
 */
describe("the host widgets", () => {
  const rendered: readonly string[] = isComposed(engineModule.name) ? ENGINE_HOST_WIDGET_REFS : []
  const expected = rendered.filter((id) => isComposed(id.split(":")[0]!))

  it("hold no widget that no composed module renders", () => {
    const stray = Object.keys(hostWidgets).filter((id) => !expected.includes(id))
    expect(
      stray,
      "host widgets no composed module renders, or whose owner is not in MODULES: drop their " +
        "spread from hostWidgets in src/ui/view-registry.ts",
    ).toEqual([])
  })

  it("hold every widget a composed module renders of another composed module", () => {
    const missing = expected.filter((id) => !(id in hostWidgets))
    expect(
      missing,
      "spread the owning module's host widgets (analyticsHostWidgets for analytics:…) into " +
        "hostWidgets in src/ui/view-registry.ts",
    ).toEqual([])
  })
})
