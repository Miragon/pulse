import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * ONE kit: widget-shell exports only what touches the host, and every consumer imports the
 * design kit from `@miragon/pulse-ui` directly. A widget-shell export under a pulse-ui name is
 * a fork or a second import path; a re-export is a second import path under any name. Read
 * statically via the TS compiler (pulse-ui's built declarations, `^build` runs first), so no
 * module counts as uncovered. Outside src/ui: it reads files from disk, and tsconfig.widgets.json
 * is browser-only.
 */

const here = dirname(fileURLToPath(import.meta.url))

interface ExportInfo {
  name: string
  /** The real paths of the files that declare it (an alias resolved to its target). */
  files: string[]
}

function exportsOf(entry: string): ExportInfo[] {
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (!source) throw new Error(`cannot read ${entry}`)
  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (!moduleSymbol) throw new Error(`${entry} has no exports`)
  return checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const files = (target.declarations ?? []).map((d) => realpathSync(d.getSourceFile().fileName))
    return { name: symbol.name, files }
  })
}

// The plain-string `./theme.css` export locates the package root: the `"."` export has only
// `types` and `import` conditions, so `require.resolve("@miragon/pulse-ui")` throws.
const UI_ROOT = realpathSync(
  dirname(dirname(createRequire(import.meta.url).resolve("@miragon/pulse-ui/theme.css"))),
)
const UI_PREFIX = UI_ROOT + sep

const PULSE_UI = {
  root: exportsOf(join(UI_ROOT, "dist/index.d.ts")).map((e) => e.name),
  format: exportsOf(join(UI_ROOT, "dist/format/index.d.ts")).map((e) => e.name),
  tones: exportsOf(join(UI_ROOT, "dist/tones/index.d.ts")).map((e) => e.name),
  testing: exportsOf(join(UI_ROOT, "dist/testing/index.d.ts")).map((e) => e.name),
}
const KIT = new Set([...PULSE_UI.root, ...PULSE_UI.format, ...PULSE_UI.tones, ...PULSE_UI.testing])
const WIDGETS = {
  widgets: exportsOf(join(here, "ui/index.ts")),
  testing: exportsOf(join(here, "testing/index.ts")),
}
const SHELL = [...WIDGETS.widgets, ...WIDGETS.testing]

describe("widget-shell exports no pulse-ui name (one kit)", () => {
  it("reads the export lists of both packages, values and types", () => {
    // Sanity: the lists are real, so an empty overlap below means something.
    for (const name of ["Button", "Icon", "formatNumber", "ToneVariant", "WidgetHeader"]) {
      expect(PULSE_UI.root, name).toContain(name)
    }
    for (const name of ["formatCount", "formatClock", "shortId", "FormatLocale"]) {
      expect(PULSE_UI.format, name).toContain(name)
    }
    for (const name of ["countTone", "severityTone", "SITUATION_TONES", "ToneVariant"]) {
      expect(PULSE_UI.tones, name).toContain(name)
    }
    for (const name of [
      "scanGlyphs",
      "themeStylesheets",
      "catalogTextFindings",
      "PRODUCT_GLOSSARY",
    ]) {
      expect(PULSE_UI.testing, name).toContain(name)
    }
    const widgets = WIDGETS.widgets.map((e) => e.name)
    for (const name of ["WidgetShell", "mountViews", "PagedRows", "useViewData"]) {
      expect(widgets, name).toContain(name)
    }
    expect(WIDGETS.testing.map((e) => e.name)).toContain("recordingModuleServer")
  })

  it("/widgets and /testing share no name with pulse-ui's root, /format, /tones or /testing", () => {
    expect(SHELL.filter((e) => KIT.has(e.name)).map((e) => e.name)).toEqual([])
  })

  it("/widgets and /testing re-export no pulse-ui piece, under any name", () => {
    const reexported = SHELL.filter((e) => e.files.some((file) => file.startsWith(UI_PREFIX)))
    expect(reexported.map((e) => e.name)).toEqual([])
  })
})
