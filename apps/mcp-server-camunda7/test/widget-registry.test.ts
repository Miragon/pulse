import ts from "typescript"
import { describe, expect, it } from "vitest"
import { collectLayoutWidgets } from "@miragon/mcp-toolkit-core"
import { cockpitViews } from "@miragon/pulse-camunda7-connector/widgets"
import {
  filterLayoutToWidgets,
  settingsLayout,
  SHELL_SETTINGS_PAGE_WIDGET,
} from "@miragon/pulse-widget-shell/widgets"
import { widgetRegistry } from "../src/ui/widget-registry.js"
import { scanSources } from "./source-scan.js"

interface WidgetIdRef {
  id: string
  /** Repo-relative `file:line`. */
  at: string
}

const WIDGET_ID = /^[a-z0-9]+:[a-z0-9-]+$/

/**
 * Every `widget: "<module>:<id>"` in code (not in comments): the ids a show
 * tool's layout or a static layout (the cockpit's views, a settings section)
 * hands the host bundle to render.
 */
function findWidgetIds(file: string, text: string): WidgetIdRef[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const refs: WidgetIdRef[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "widget" &&
      ts.isStringLiteralLike(node.initializer) &&
      WIDGET_ID.test(node.initializer.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.initializer.getStart())
      refs.push({ id: node.initializer.text, at: `${file}:${line + 1}` })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return refs
}

/**
 * Modules are peers and never import each other, so only the app sees every
 * module's ids next to the host bundle's registry.
 */
const named = scanSources(findWidgetIds, { scope: "mcp" })
const namedIds = new Set(named.map((ref) => ref.id))

/**
 * A view names its widgets by id and the host bundle resolves them in
 * `src/ui/widget-registry.ts`. Both halves fail SILENTLY: an id the bundle
 * cannot resolve renders as an empty slot, and a registry entry nothing names
 * is dead code shipped in every view's bundle.
 */
describe("host widget registry vs the ids the views name", () => {
  it("resolves every id a show tool or a static layout names", () => {
    const missing = named.filter((ref) => !(ref.id in widgetRegistry))
    expect(missing.map((ref) => `${ref.id} (${ref.at})`)).toEqual([])
  })

  it("holds no entry nothing renders", () => {
    // The settings sections are assembled from the registry by convention, and
    // the shell's page is named by a constant (its show tool, the cockpit tab).
    const reachable = new Set([
      ...namedIds,
      ...collectLayoutWidgets(settingsLayout(Object.keys(widgetRegistry))),
      SHELL_SETTINGS_PAGE_WIDGET,
    ])
    expect(Object.keys(widgetRegistry).filter((id) => !reachable.has(id))).toEqual([])
  })

  it("sees the show tools, the static layouts and the settings sections (the scanner is not blind)", () => {
    expect([...namedIds]).toEqual(
      expect.arrayContaining([
        "camunda7:cockpit-app",
        "camunda7:process-list",
        "camunda7:process-definitions-table",
        "camunda7:settings",
        "analytics:execution-summary-kpi",
        "analytics:engine-landscape",
        "analytics:settings",
      ]),
    )
    expect(named.some((ref) => ref.at.includes("/widgets/cockpit-app/views.ts:"))).toBe(true)
    // A cross-module cell: the cockpit's fleet view names the analytics landscape.
    expect(
      named
        .filter((ref) => ref.at.includes("/widgets/cockpit-app/fleet-view.tsx:"))
        .map((ref) => ref.id),
    ).toEqual(["analytics:engine-landscape"])
  })

  it("reads code, never a comment, a constant or a data type", () => {
    const text = [
      'const a = { row: [{ widget: "camunda7:a", props: {} }] }',
      '// const b = { widget: "camunda7:b" }',
      "const c = { widget: SOME_WIDGET, d: { widget: `analytics:${name}` } }",
      'const e = { dataType: "analytics:dashboard", "widget": "shell:e" }',
    ].join("\n")
    expect(findWidgetIds("x.ts", text)).toEqual([
      { id: "camunda7:a", at: "x.ts:1" },
      { id: "shell:e", at: "x.ts:4" },
    ])
  })
})

/**
 * The settings page (the shell's, #346) composes the shell's language section
 * and one section widget per module, and it assembles that layout from THIS
 * host's widget registry (`settingsLayout`, by the `<module>:settings`
 * convention) — so the page extends to modules no package has heard of. Its
 * failure modes stay SILENT: a section whose widget never reaches the host
 * registry is simply absent from the page, and an id that resolves nowhere is
 * dropped by `filterLayoutToWidgets`.
 * Every other check stays green either way, so this test is the only thing
 * standing between a shipped settings section and an invisible one.
 */
describe("settings page composes every module's settings section", () => {
  // The runtime input: the ids this host bundle can render, in registration
  // order — exactly what the page reads from the host registry.
  const hostWidgetIds = Object.keys(widgetRegistry)
  const sectionIds = collectLayoutWidgets(settingsLayout(hostWidgetIds))

  /** The sections the modules register (`registerSettingsSection`): `<module>:settings`. */
  const moduleSections = [...namedIds].filter((id) => id.endsWith(":settings"))

  it("is what the cockpit's settings tab renders, and the host bundles it", () => {
    expect(collectLayoutWidgets(cockpitViews.settings({ engine: "prod-a" }))).toEqual([
      SHELL_SETTINGS_PAGE_WIDGET,
    ])
    expect(widgetRegistry).toHaveProperty(SHELL_SETTINGS_PAGE_WIDGET)
  })

  it("leads with the shell's language section", () => {
    expect(sectionIds[0]).toBe("shell:settings")
  })

  it("lists every module's settings section (a missing row = an invisible section)", () => {
    expect(moduleSections).toEqual(
      expect.arrayContaining(["camunda7:settings", "analytics:settings"]),
    )
    const missing = moduleSections.filter((id) => !sectionIds.includes(id))
    expect(missing).toEqual([])
  })

  it("only lists ids the host bundle can resolve (a typo = a silently dropped row)", () => {
    const unresolvable = sectionIds.filter((id) => !(id in widgetRegistry))
    expect(unresolvable).toEqual([])
  })

  it("survives filtering against the host registry with all sections intact", () => {
    // The runtime path: HostWidgetsProvider resolves the raw ids and
    // filterLayoutToWidgets drops whatever it can't. With every module mounted,
    // nothing may be dropped.
    const filtered = filterLayoutToWidgets(settingsLayout(hostWidgetIds), widgetRegistry)
    expect(collectLayoutWidgets(filtered)).toEqual(sectionIds)
  })

  it("degrades to the remaining sections when a module is absent", () => {
    // Graceful degradation: a host without the analytics module renders
    // no analytics section instead of erroring on an unknown widget id.
    const withoutAnalytics = Object.fromEntries(
      Object.entries(widgetRegistry).filter(([id]) => !id.startsWith("analytics:")),
    )
    const filtered = filterLayoutToWidgets(
      settingsLayout(Object.keys(withoutAnalytics)),
      withoutAnalytics,
    )
    const remaining = collectLayoutWidgets(filtered)
    expect(remaining).toContain("camunda7:settings")
    expect(remaining.some((id) => id.startsWith("analytics:"))).toBe(false)
  })

  it("extends to a CUSTOM module's section without an edit anywhere else", () => {
    // What a composed server (the starter template) relies on: register a
    // `<module>:settings` widget in the host bundle and the page grows a row.
    const CustomSection = () => null
    const withCustomModule = { ...widgetRegistry, "acme:settings": CustomSection }
    const composed = collectLayoutWidgets(
      filterLayoutToWidgets(settingsLayout(Object.keys(withCustomModule)), withCustomModule),
    )
    expect(composed).toEqual([...sectionIds, "acme:settings"])
  })
})
