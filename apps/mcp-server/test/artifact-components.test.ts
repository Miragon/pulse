import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  componentsSheet,
  NAMED_ONLY,
  renderComponentsSheet,
  SHEET,
  SHEET_FILE,
  SHEET_PATH,
  REPO_ROOT,
  sheetValueNames,
  UI_PACKAGE,
} from "./artifact-components.js"
import { UPDATE_COMMAND } from "./golden.js"

/**
 * The pulse-artifact skill's component cheat sheet is generated, never written by hand: this
 * test renders it from the built declarations (`^build` ran) and holds the committed file to it,
 * so a prop pulse-ui, blocks, screens, widget-shell or c7-core changes reaches the skill in the
 * same PR. `GOLDEN_UPDATE=1` (the `golden:update` script, refused in CI like every golden)
 * rewrites it. The TypeScript checker over the kit's, React's and lucide's typings takes about 2 s
 * alone, and many times that beside the repository's other suites under `pnpm test`.
 */
describe(SHEET_FILE, { timeout: 120_000 }, () => {
  it("is the packages' declarations as they are built", async () => {
    const sheet = await componentsSheet()
    if (process.env.GOLDEN_UPDATE === "1") {
      if (process.env.CI) {
        throw new Error(
          `GOLDEN_UPDATE is forbidden in CI: ${SHEET_FILE} changes in a reviewed diff.`,
        )
      }
      fs.writeFileSync(SHEET_PATH, sheet, "utf8")
      console.warn(`GOLDEN UPDATED: ${SHEET_FILE}. Commit the diff.`)
      return
    }
    const committed = fs.existsSync(SHEET_PATH) ? fs.readFileSync(SHEET_PATH, "utf8") : ""
    expect(
      committed,
      `${SHEET_FILE} differs from the declarations the packages build. Never edit it by hand: run \`${UPDATE_COMMAND}\` and commit the diff.`,
    ).toBe(sheet)
  })

  it("documents every name it lists, once, with its props", () => {
    const sheet = renderComponentsSheet()
    const names = SHEET.flatMap((group) => group.names)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(sheet).toContain(`### ${name}\n`)
    // the pair CountFigure takes together, kept as alternatives instead of two loose props
    expect(sheet).toMatch(/situation\?: undefined\s+label\?: undefined/)
    // a component's props are spelled out, not named by a type the reader cannot see
    expect(sheet).toContain("declare function KpiGrid(props: {")
    // deprecated props stay out (WidgetHeader's icon and iconTone)
    expect(sheet).not.toContain("iconTone")
  })

  it("defines every type of the kit its blocks name, or says why it keeps one a name", () => {
    const sheet = renderComponentsSheet()
    // the types a page passes or reads: Facts' facts, createUseT's translator and result
    for (const name of ["Fact", "StatusStripAction", "KpiGridHeader", "Translate", "T"]) {
      expect(sheet).toContain(`### ${name}\n`)
    }
    // a type its package keeps to itself is spelled out at the prop that uses it
    expect(sheet).toMatch(/labels\?: \{\s+zoomIn\?: string/)
    expect(sheet).not.toContain("BpmnZoomControlsLabels")
    // each type kept a name is one a block still names, never one the sheet defines
    const code = [...sheet.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]).join("\n")
    const defined = new Set(SHEET.flatMap((group) => group.names))
    for (const name of Object.keys(NAMED_ONLY)) {
      expect(code, name).toMatch(new RegExp(`\\b${name}\\b`))
      expect(defined.has(name), name).toBe(false)
    }
  })

  it("refuses a sheet whose block names a type it defines nowhere", () => {
    const groups = SHEET.map((group) => ({
      ...group,
      names: group.names.filter((name) => name !== "Fact"),
    }))
    expect(() => renderComponentsSheet(groups)).toThrow(
      "The sheet names types it defines nowhere: Fact (named by Facts).",
    )
  })

  it("names the entry and the name a page imports when either is missing", () => {
    const [group] = SHEET
    if (group === undefined) throw new Error("SHEET is empty")
    const missing = [{ ...group, names: ["NoSuchComponent"] }]
    expect(() => renderComponentsSheet(missing)).toThrow(
      `${group.entry} exports no NoSuchComponent.`,
    )
    const unbuilt = [{ ...group, entry: "packages/core/ui/dist/none.d.ts" }]
    expect(() => renderComponentsSheet(unbuilt)).toThrow("is not built")
  })
})

/**
 * The names an ES module exports: the `export { … }` clauses of a bundle as esbuild writes it,
 * and of a module as tsc does (`export const`, `export function`).
 */
function exportedNames(file: string): Set<string> {
  const code = fs.readFileSync(file, "utf8")
  const names = new Set<string>()
  for (const [, list = ""] of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of list.split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (name) names.add(name)
    }
  }
  for (const [, name = ""] of code.matchAll(/\bexport\s+(?:const|let|function|class)\s+(\w+)/g)) {
    names.add(name)
  }
  return names
}

describe("the sheet's way without a build", { timeout: 120_000 }, () => {
  it("names, per section, a file of pulse-ui's package that exports every name a page calls", () => {
    const values = sheetValueNames()
    for (const group of SHEET) {
      if (group.withoutBuild === null) continue
      const file = path.join(REPO_ROOT, UI_PACKAGE, group.withoutBuild)
      const missing = (values.get(group.from) ?? []).filter(
        (name) => !exportedNames(file).has(name),
      )
      expect(missing, `${group.from} without a build (${group.withoutBuild})`).toEqual([])
    }
  })

  it("says where no file holds a section's names, as the browser bundle holds none of widget-shell", () => {
    const shell = SHEET.find((group) => group.from === "@miragon/pulse-widget-shell/widgets")
    expect(shell?.withoutBuild).toBeNull()
    const bundle = exportedNames(path.join(REPO_ROOT, UI_PACKAGE, "dist/browser/pulse-ui.js"))
    expect(shell?.names.filter((name) => bundle.has(name))).toEqual([])
    expect(renderComponentsSheet()).toContain(
      "words every failure with pulse-ui's `describePageError`",
    )
  })
})
