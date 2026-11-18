import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * One row convention on every surface (owner direction of 2026-11-18, `docs/vscode/parity.md`): a
 * table row opens what it names on a click or Enter and copies its id on Ctrl or Cmd with C, as
 * the webview's rows do, through widget-shell's `ListRow` (pulse-ui's `DataTableRow`, which names
 * the row and tells a screen reader that Enter opens it); it carries no drill. Its further actions
 * (a write, a hand-off, `MoreActions`) stay controls at the row's end, `xs` (24 px) so the row
 * keeps the row height (the density section's named deviation, root CLAUDE.md), and open nothing.
 * A drill outside a table (a card's) is pulse-ui's `DrillButton`, never a `Button` dressed up with
 * a trailing arrow: one drill control, the kit's (CLAUDE.md invariant 6), `xs` like a row's
 * actions but where a card names its reason.
 */

const WIDGETS = join(import.meta.dirname, "widgets")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry) && !/\.test(-support)?\.tsx?$/.test(entry) ? [path] : []
  })
}

const read = (path: string) => readFileSync(path, "utf8")

/** A file that composes table rows: its cells, its rows or a `ListTable` of them. */
const COMPOSES_ROWS = /<Td\b|<tr\b|<ListTable\b|<ListRow\b/

/** The tables whose rows open a view of the cockpit, each through `ListRow`. */
const OPENING_TABLES = [
  "board/board-table.tsx",
  "cluster-detail.tsx",
  "process-definitions-table-view.tsx",
  "process-incidents/incident-table.tsx",
  "process-instances/instance-row.tsx",
]

/** Each opening tag of `tag` (`tr`, `Button`): up to the first `>` outside its attributes' braces. */
function openings(source: string, tag: string): string[] {
  const tags: string[] = []
  for (const start of source.matchAll(new RegExp(`<${tag}\\b`, "g"))) {
    let depth = 0
    for (let i = start.index; i < source.length; i++) {
      const c = source[i]
      if (c === "{") depth++
      else if (c === "}") depth--
      else if (c === ">" && depth === 0) {
        tags.push(source.slice(start.index, i + 1))
        break
      }
    }
  }
  return tags
}

/** A file whose controls sit at a row's end: it composes rows or hands a table its rows' actions. */
const ROW_CONTROLS = new RegExp(`${COMPOSES_ROWS.source}|\\brenderActions=`)

/** The controls a row's end holds: the kit's `Button`, a chat hand-off, a drill. */
const CONTROLS = ["Button", "HandOffButton", "DrillButton"]

/** A menu's entry or a view bar's button: sized by its menu or its bar, not by a row. */
const SIZED_ELSEWHERE = /\bvariant="(?:menuitem|toolbar)"/

/**
 * The controls of a row file that are not `xs`, by file, each with its reason: the row grows to
 * hold them, so they keep the size of what they stand beside.
 */
const NOT_XS_IN_A_ROW: Readonly<Record<string, { count: number; reason: string }>> = {
  "instance-sections.tsx": {
    count: 2,
    reason:
      "a variable's edit form: Save and Cancel at 28 px beside its 28 px input, in a row grown to hold it",
  },
}

/** The controls of a source that a row's size rule holds: not xs, not sized by a menu or a bar. */
function notXs(source: string): string[] {
  return CONTROLS.flatMap((tag) => openings(source, tag)).filter(
    (tag) => !/\bsize="xs"/.test(tag) && !SIZED_ELSEWHERE.test(tag),
  )
}

/** The drills that sit on a card and stay `sm`, each with its reason. */
const SM_DRILLS: Readonly<Record<string, string>> = {
  "engine-health.tsx": "a failure cluster's card on the overview, its actions beside its facts",
}

/** A `<Button …>` whose last child is an `ArrowRight` icon: a drill in disguise. */
const DRESSED_DRILL =
  /<Button\b[^>]*>(?:(?!<\/Button>)[\s\S])*?<Icon icon=\{ArrowRight\}[^>]*\/>\s*<\/Button>/

describe("one row convention: a table row opens on a click or Enter", () => {
  it("gives a table row no drill: the row itself opens what it names", () => {
    const offenders = sources(WIDGETS)
      .filter((path) => {
        const source = read(path)
        return COMPOSES_ROWS.test(source) && /<DrillButton\b/.test(source)
      })
      .map((path) => relative(WIDGETS, path))
    expect(offenders).toEqual([])
  })

  it("opens a row through ListRow, never a hand-made row target or the bare kit row", () => {
    const offenders = sources(WIDGETS).flatMap((path) => {
      const source = read(path)
      const handMade = openings(source, "tr").filter((tag) =>
        /\b(onClick|onKeyDown|tabIndex|role)=/.test(tag),
      )
      const bare = /<DataTableRow\b/.test(source) ? ["DataTableRow"] : []
      return [...handMade, ...bare].map(() => relative(WIDGETS, path))
    })
    expect(offenders).toEqual([])
  })

  it("sizes a row's further actions xs (24 px), so the row keeps the row height", () => {
    const offenders = sources(WIDGETS).flatMap((path) => {
      const source = read(path)
      const file = relative(WIDGETS, path)
      if (!ROW_CONTROLS.test(source)) return []
      const allowed = NOT_XS_IN_A_ROW[file]?.count ?? 0
      const found = notXs(source)
      return found.length === allowed ? [] : [`${file}: ${found.join(" ")}`]
    })
    expect(offenders).toEqual([])
    // Each allowance is still a row file's.
    for (const file of Object.keys(NOT_XS_IN_A_ROW)) {
      expect(ROW_CONTROLS.test(read(join(WIDGETS, file))), file).toBe(true)
    }
  })

  it("the size scan sees a row's control that is not xs, and leaves menus and bars alone", () => {
    const row = `<ListRow label="x" onOpen={go}><Td>
      <Button variant="outline" onClick={() => retry({ id })}>Retry</Button>
      <HandOffButton action="explainError" size="xs" prompt={p} />
      <HandOffButton action="draftTicket" variant="menuitem" prompt={p} />
    </Td></ListRow>`
    expect(ROW_CONTROLS.test(row)).toBe(true)
    expect(notXs(row)).toEqual([`<Button variant="outline" onClick={() => retry({ id })}>`])
    expect(ROW_CONTROLS.test(`<Table renderActions={(row) => <Button size="sm" />} />`)).toBe(true)
    expect(notXs(`<Button variant="toolbar" size="sm" onClick={go}>`)).toEqual([])
  })

  it("composes the rows of every table that opens a view as ListRow", () => {
    for (const file of OPENING_TABLES) {
      expect(read(join(WIDGETS, file)), file).toMatch(/<ListRow\b/)
    }
  })

  it("the scan reads a row's whole opening tag, its arrow functions included", () => {
    const row = `<tr
      onClick={() => go({ type: "x" })}
      className="a"
    >`
    expect(openings(`${row}<td /></tr>`, "tr")).toEqual([row])
    expect(openings(`<tr key={row.id}><td /></tr>`, "tr")).toEqual(["<tr key={row.id}>"])
    // A tag whose name starts the same is another tag.
    expect(openings(`<track /><tr>`, "tr")).toEqual(["<tr>"])
  })
})

describe("one drill control outside tables", () => {
  it("every drill is pulse-ui's DrillButton, never a Button with a trailing arrow", () => {
    const offenders = sources(WIDGETS)
      .filter((path) => DRESSED_DRILL.test(read(path)))
      .map((path) => relative(WIDGETS, path))
    expect(offenders).toEqual([])
  })

  it("a DrillButton is named by its ariaLabel prop: an aria-label attribute would be dropped", () => {
    // TypeScript does not check hyphenated JSX attributes, and DrillButton
    // spreads nothing: `aria-label` on it compiles and silently names nothing.
    const offenders = sources(WIDGETS).flatMap((path) =>
      (read(path).match(/<DrillButton\b(?:(?!<\/DrillButton>)[\s\S])*?<\/DrillButton>/g) ?? [])
        .filter((block) => /\baria-label=/.test(block))
        .map(() => relative(WIDGETS, path)),
    )
    expect(offenders).toEqual([])
  })

  it("sizes a card's drill xs, as a row's actions, but where a card names its reason", () => {
    const offenders = sources(WIDGETS)
      .filter((path) => !Object.hasOwn(SM_DRILLS, relative(WIDGETS, path)))
      .flatMap((path) =>
        openings(read(path), "DrillButton")
          .filter((tag) => !/\bsize="xs"/.test(tag))
          .map(() => relative(WIDGETS, path)),
      )
    expect(offenders).toEqual([])
    // Each allowance still holds a drill of its own.
    for (const file of Object.keys(SM_DRILLS)) {
      expect(openings(read(join(WIDGETS, file)), "DrillButton")).not.toEqual([])
    }
  })

  it("keeps a drill where no table is: a card's way into its view", () => {
    const cards = sources(WIDGETS).filter((path) => /<DrillButton\b/.test(read(path)))
    expect(cards.map((path) => relative(WIDGETS, path)).sort()).toEqual([
      "engine-health.tsx",
      "incidents-dashboard/process-list.tsx",
    ])
  })

  it("the scan sees a dressed drill (the pattern is not vacuous)", () => {
    const dressed = `<Button type="button" variant="outline" size="sm" onClick={go}>
      Open
      <Icon icon={ArrowRight} />
    </Button>`
    expect(DRESSED_DRILL.test(dressed)).toBe(true)
    expect(DRESSED_DRILL.test(`<DrillButton onDrill={go}>Open</DrillButton>`)).toBe(false)
  })
})
