import fs from "node:fs"
import path from "node:path"
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

const SERVER_ROOT = path.join(import.meta.dirname, "..")

const WIDGET_ID = /^[a-z0-9-]+:[a-z0-9-]+$/

/**
 * Every `widget: "<module>:<id>"` in code, never in a comment: the ids a show
 * tool's view result (or a static layout) hands the host bundle to render.
 */
function findWidgetIds(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const ids: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "widget" &&
      ts.isStringLiteralLike(node.initializer) &&
      WIDGET_ID.test(node.initializer.text)
    ) {
      ids.push(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return ids
}

/** Test code may name ids no module renders; only what ships counts. */
const isShippedSource = (file: string) =>
  /\.tsx?$/.test(file) && !/\.(?:test|spec|test-support)\.tsx?$/.test(file)

/**
 * The source directories of the module packages this server depends on: every
 * entry of `server/package.json` `dependencies` that exports `./widgets` and
 * ships its `src/` — the Pulse connectors from npm and your workspace modules
 * alike, so a module wired through its dependency is covered without an edit
 * here. widget-shell ships `dist/` only; its settings page is checked by id
 * below.
 */
function moduleSourceDirs(): string[] {
  const read = (file: string) =>
    JSON.parse(fs.readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>
      exports?: Record<string, unknown>
    }
  const { dependencies = {} } = read(path.join(SERVER_ROOT, "package.json"))
  return Object.keys(dependencies)
    .map((name) => path.join(SERVER_ROOT, "node_modules", name))
    .filter((dir) => read(path.join(dir, "package.json")).exports?.["./widgets"] !== undefined)
    .map((dir) => path.join(dir, "src"))
    .filter((src) => fs.existsSync(src))
    .map((src) => fs.realpathSync(src))
}

/** Every widget id the modules' shipped sources name, in source order, once each. */
function emittedWidgetIds(): string[] {
  const ids = moduleSourceDirs().flatMap((dir) =>
    fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter(isShippedSource)
      .flatMap((file) => findWidgetIds(file, fs.readFileSync(path.join(dir, file), "utf8"))),
  )
  return [...new Set(ids)]
}

const emitted = emittedWidgetIds()

/**
 * The host bundle map must render every widget a module can put on screen: a
 * show tool returns its view naming the widget by id, and an id missing from
 * `widgetRegistry` renders as an empty slot. The ids come from the modules'
 * sources, so name each one as a string literal (`widget: "<module>:<id>"`)
 * where the show tool builds its view.
 */
describe("host widget registry covers every widget the modules name", () => {
  it("reads the show tools of the Miragon modules and the notes module (the scan is not blind)", () => {
    expect(emitted).toContain("notes:list")
    expect(emitted.some((id) => id.startsWith("camunda7:"))).toBe(true)
    expect(emitted.some((id) => id.startsWith("analytics:"))).toBe(true)
  })

  it("has an entry for every widget id a module's sources name", () => {
    const missing = emitted.filter((id) => !(id in widgetRegistry))
    expect(missing).toEqual([])
  })

  it("reads code, never a comment or a constant", () => {
    const text = [
      'const a = { row: [{ widget: "notes:a", props: {} }] }',
      '// const b = { widget: "notes:b" }',
      "const c = { widget: SOME_WIDGET, d: { widget: `notes:${name}` } }",
      'const e = { dataType: "notes:list", "widget": "notes:e" }',
    ].join("\n")
    expect(findWidgetIds("x.ts", text)).toEqual(["notes:a", "notes:e"])
  })
})

/**
 * The settings page (the shell's) leads with the UI language and composes one
 * section widget per module, assembled from THIS server's widget registry:
 * every widget id ending in `:settings` gets a row, in registration order —
 * YOUR module's section included, with no edit in any package. The failure
 * mode stays SILENT: a section whose widget never reaches `widgetRegistry` is
 * simply absent from the settings tab.
 */
describe("settings page composes every module's settings section", () => {
  // What the page reads at runtime: the ids this bundle can render.
  const hostWidgetIds = Object.keys(widgetRegistry)
  const sectionIds = collectLayoutWidgets(settingsLayout(hostWidgetIds))

  const emittedSections = emitted.filter((id) => id.endsWith(":settings"))

  it("is what the cockpit's settings tab renders, and the bundle has it", () => {
    expect(collectLayoutWidgets(cockpitViews.settings({ engine: "prod-a" }))).toEqual([
      SHELL_SETTINGS_PAGE_WIDGET,
    ])
    expect(widgetRegistry).toHaveProperty(SHELL_SETTINGS_PAGE_WIDGET)
  })

  it("lists every module's settings section (a missing row = an invisible section)", () => {
    const missing = emittedSections.filter((id) => !sectionIds.includes(id))
    expect(missing).toEqual([])
  })

  it("only lists ids the host bundle can resolve (a typo = a silently dropped row)", () => {
    const unresolvable = sectionIds.filter((id) => !(id in widgetRegistry))
    expect(unresolvable).toEqual([])
  })

  it("survives filtering against the host registry with all sections intact", () => {
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

  it("grows a row for a custom module's `<module>:settings` widget", () => {
    // The extension point: give your section widget the `<module>:settings` id
    // and spread your module's widget map into `widgetRegistry` — the settings
    // page picks it up. The stand-in id belongs to no composed module on purpose
    // (NOT `notes:settings`): the day mcp-notes grows a real section, that id
    // is already in `sectionIds` and the expectation below would demand it
    // twice — a correct change turning this test red.
    const CustomSection = () => null
    const withCustomModule = { ...widgetRegistry, "your-module:settings": CustomSection }
    const composed = collectLayoutWidgets(
      filterLayoutToWidgets(settingsLayout(Object.keys(withCustomModule)), withCustomModule),
    )
    expect(composed).toEqual([...sectionIds, "your-module:settings"])
  })
})
