import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A view's actions have the kit's `Button` scale: its header's are `sm` (28 px, 13 px, 600), a
 * table row's are `xs` (24 px), so every row keeps the row height (28 px, 40 px comfortable) and a
 * row's "Open" sits level with the chat icon button and the menu beside it (the density section's
 * named deviation, root CLAUDE.md). A drill is pulse-ui's `DrillButton`, the outline `Button` at
 * that scale (Miragon/mcp-toolkit#194), never a `Button` dressed up with a trailing arrow: one
 * drill control, the kit's (CLAUDE.md invariant 6).
 */

const WIDGETS = join(import.meta.dirname, "widgets")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry) && !/\.test(-support)?\.tsx?$/.test(entry) ? [path] : []
  })
}

/** The drills that sit in no table row (a card's actions), each with its reason: they stay `sm`. */
const NOT_IN_A_ROW: Readonly<Record<string, string>> = {
  "engine-health.tsx": "a failure cluster's card on the overview, its actions beside its facts",
}

/** Each `DrillButton`'s opening tag: up to the first `>` outside its attributes' braces. */
function drillOpenings(source: string): string[] {
  const tags: string[] = []
  for (const start of source.matchAll(/<DrillButton\b/g)) {
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

/** A `<Button …>` whose last child is an `ArrowRight` icon: a drill in disguise. */
const DRESSED_DRILL =
  /<Button\b[^>]*>(?:(?!<\/Button>)[\s\S])*?<Icon icon=\{ArrowRight\}[^>]*\/>\s*<\/Button>/

describe("one drill control, at the one action size", () => {
  it("every drill is pulse-ui's DrillButton, never a Button with a trailing arrow", () => {
    const offenders = sources(WIDGETS)
      .filter((path) => DRESSED_DRILL.test(readFileSync(path, "utf8")))
      .map((path) => relative(WIDGETS, path))
    expect(offenders).toEqual([])
  })

  it("a DrillButton is named by its ariaLabel prop: an aria-label attribute would be dropped", () => {
    // TypeScript does not check hyphenated JSX attributes, and DrillButton
    // spreads nothing: `aria-label` on it compiles and silently names nothing.
    const offenders = sources(WIDGETS).flatMap((path) =>
      (
        readFileSync(path, "utf8").match(
          /<DrillButton\b(?:(?!<\/DrillButton>)[\s\S])*?<\/DrillButton>/g,
        ) ?? []
      )
        .filter((block) => /\baria-label=/.test(block))
        .map(() => relative(WIDGETS, path)),
    )
    expect(offenders).toEqual([])
  })

  it("a drill in a table row is xs (24 px), so the row keeps the row height", () => {
    const offenders = sources(WIDGETS)
      .filter((path) => !Object.hasOwn(NOT_IN_A_ROW, relative(WIDGETS, path)))
      .flatMap((path) =>
        drillOpenings(readFileSync(path, "utf8"))
          .filter((tag) => !/\bsize="xs"/.test(tag))
          .map(() => relative(WIDGETS, path)),
      )
    expect(offenders).toEqual([])
    // Each allowance still holds a drill of its own.
    for (const file of Object.keys(NOT_IN_A_ROW)) {
      expect(drillOpenings(readFileSync(join(WIDGETS, file), "utf8"))).not.toEqual([])
    }
  })

  it("the scan reads a drill's whole opening tag, its arrow functions included", () => {
    const drill = `<DrillButton
      onDrill={() => go({ type: "x" })}
      ariaLabel={t("a", { name })}
      size="xs"
    >`
    expect(drillOpenings(`${drill}Open</DrillButton>`)).toEqual([drill])
    expect(drillOpenings(`<DrillButton onDrill={() => go()}>Open</DrillButton>`)).toEqual([
      "<DrillButton onDrill={() => go()}>",
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
