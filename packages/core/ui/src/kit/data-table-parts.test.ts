import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * A table without sizing or selection loads none of their parts: the grip, the column menu and
 * their measuring come with `useColumnSizing`'s object, the selection's box with `rowSelection`'s.
 * So the table's own modules import none of them, and a bundle whose tables never size or select
 * (the MCP views' `ListTable`) tree-shakes them out.
 */

/** The names a module imports as values, by specifier (`import type` and `type` names left out). */
function valueImports(file: string): Map<string, string[]> {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const imports = new Map<string, string[]>()
  for (const [, names = "", from = ""] of source.matchAll(
    /^import (?!type )\{([^}]*)\} from "([^"]+)"/gm,
  )) {
    const values = names
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type "))
    if (values.length > 0) imports.set(from, values)
  }
  return imports
}

describe("DataTable's own modules", () => {
  it.each(["./data-table.tsx", "./data-table-body.tsx"])(
    "%s imports neither the sizing parts nor the selection's box",
    (file) => {
      const imports = valueImports(file)
      expect(imports.has("../lib/utils.js")).toBe(true)
      for (const part of [
        "./column-grip.js",
        "./column-menu.js",
        "./use-column-sizing.js",
        "./row-selection.js",
        "../primitives/checkbox.js",
      ]) {
        expect(imports.has(part), part).toBe(false)
      }
      // Of the measuring only the head's key attribute, which the table writes itself.
      expect(imports.get("./column-measure.js") ?? []).not.toContain("columnSizer")
    },
  )
})
