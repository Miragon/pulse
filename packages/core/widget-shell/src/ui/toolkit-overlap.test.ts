import { createRequire } from "node:module"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * ONE kit: a widget-shell export under a toolkit name is a fork or a second
 * import path. Read statically via the TS compiler, so no kit module counts as uncovered.
 */

const here = dirname(fileURLToPath(import.meta.url))
const TOOLKIT_DIR = `${sep}@miragon${sep}mcp-toolkit-ui${sep}`

/** Shrink-only: an entry leaves when its subpath goes. */
const PASS_THROUGH: Readonly<Record<string, string>> = {
  adaptDataWidget:
    "the /ui subpath is the module widget registries' one import of the toolkit's data adapter (CLAUDE.md invariant 3)",
  DescribeForModel: "the type of that adapter's model-context callback, on the same /ui subpath",
}

interface ExportInfo {
  name: string
  fromToolkit: boolean
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
    const files = (target.declarations ?? []).map((d) => d.getSourceFile().fileName)
    return {
      name: symbol.name,
      fromToolkit: files.some((file) => file.split("/").join(sep).includes(TOOLKIT_DIR)),
    }
  })
}

function toolkitDeclarations(): string[] {
  const require = createRequire(import.meta.url)
  // The plain-string `./theme.css` export locates the package root.
  const root = dirname(dirname(require.resolve("@miragon/mcp-toolkit-ui/theme.css")))
  return ["dist/index.d.ts", "dist/app/index.d.ts", "dist/hooks/index.d.ts"].map((entry) =>
    join(root, entry),
  )
}

const TOOLKIT = new Set(
  toolkitDeclarations().flatMap((entry) => exportsOf(entry).map((e) => e.name)),
)
const WIDGETS = exportsOf(join(here, "index.ts"))
const UI = exportsOf(join(here, "../adapt-data-widget.tsx"))

describe("widget-shell exports no toolkit name (one kit, toolkit 2.8)", () => {
  it("reads both export lists, values and types", () => {
    // Sanity: the lists are real, so an empty overlap below means something.
    for (const name of ["KpiGrid", "StatusBadge", "WidgetHeader", "ToneVariant", "useViewData"]) {
      expect(TOOLKIT.has(name), name).toBe(true)
    }
    const kit = WIDGETS.map((e) => e.name)
    for (const name of ["WidgetShell", "PagedRows", "usePagedViewData", "PagedViewData"]) {
      expect(kit, name).toContain(name)
    }
  })

  it("the /widgets barrel shares no name with the toolkit — no fork, no second import path", () => {
    expect(WIDGETS.filter((e) => TOOLKIT.has(e.name)).map((e) => e.name)).toEqual([])
  })

  it("the /widgets barrel re-exports no toolkit piece, under any name", () => {
    expect(WIDGETS.filter((e) => e.fromToolkit).map((e) => e.name)).toEqual([])
  })

  it("the /ui subpath passes only the listed toolkit pieces through, as the toolkit's own", () => {
    const shared = UI.filter((e) => TOOLKIT.has(e.name))
    expect(shared.map((e) => e.name).sort()).toEqual(Object.keys(PASS_THROUGH).sort())
    // A pass-through is the toolkit's declaration itself, never a look-alike.
    expect(shared.filter((e) => !e.fromToolkit)).toEqual([])
  })
})
