import { createRequire } from "node:module"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/**
 * ONE kit: a widget-shell export under a toolkit name is a fork or a second
 * import path. Read statically via the TS compiler, so no kit module counts as uncovered.
 * The toolkit is its ROOT design kit: its app and hooks entries are no longer Pulse's (an ESLint
 * gate bans them), and Pulse's view runtime owns the few names their query layer shared.
 */

const here = dirname(fileURLToPath(import.meta.url))
const TOOLKIT_DIR = `${sep}@miragon${sep}mcp-toolkit-ui${sep}`

/**
 * Names Pulse's view runtime deliberately shares with the toolkit root's query layer, which the
 * ESLint gate bans: Pulse's own implementation, never a re-export (shrink-only).
 */
const OWNED_RUNTIME: Readonly<Record<string, string>> = {
  useToolQuery: "the view's tool read over the view host (tool-query.ts)",
  useToolMutation: "the view's tool write with key-prefix invalidation (tool-query.ts)",
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
  return [join(root, "dist/index.d.ts")]
}

const TOOLKIT = new Set(
  toolkitDeclarations().flatMap((entry) => exportsOf(entry).map((e) => e.name)),
)
const WIDGETS = exportsOf(join(here, "index.ts"))

describe("widget-shell exports no toolkit name (one kit, toolkit 2.8)", () => {
  it("reads both export lists, values and types", () => {
    // Sanity: the lists are real, so an empty overlap below means something.
    for (const name of ["KpiGrid", "StatusBadge", "WidgetHeader", "ToneVariant", "useToolQuery"]) {
      expect(TOOLKIT.has(name), name).toBe(true)
    }
    const kit = WIDGETS.map((e) => e.name)
    for (const name of [
      "WidgetShell",
      "PagedRows",
      "usePagedViewData",
      "mountViews",
      "useViewData",
    ]) {
      expect(kit, name).toContain(name)
    }
  })

  it("the /widgets barrel shares no name with the toolkit — no fork, no second import path", () => {
    const shared = WIDGETS.filter((e) => TOOLKIT.has(e.name)).map((e) => e.name)
    expect(shared.filter((name) => !(name in OWNED_RUNTIME))).toEqual([])
  })

  it("the runtime's owned names are Pulse's own and still collide (else the entry goes)", () => {
    for (const name of Object.keys(OWNED_RUNTIME)) {
      expect(TOOLKIT.has(name), name).toBe(true)
      const own = WIDGETS.find((e) => e.name === name)
      expect(own, name).toBeDefined()
      expect(own?.fromToolkit, name).toBe(false)
    }
  })

  it("the /widgets barrel re-exports no toolkit piece, under any name", () => {
    expect(WIDGETS.filter((e) => e.fromToolkit).map((e) => e.name)).toEqual([])
  })
})
