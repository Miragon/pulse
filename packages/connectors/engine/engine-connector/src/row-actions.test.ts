import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Every action a view shows, in its head and in its rows, has one size: the
 * kit's `Button` scale (32 px, 13 px, 600), so a row's "Open" sits level
 * with the chat icon button beside it. A drill is pulse-ui's `DrillButton`,
 * the outline `Button` at that scale (Miragon/mcp-toolkit#194), never a
 * `Button` dressed up with a trailing arrow: one drill control, the kit's
 * (CLAUDE.md invariant 6).
 */

const WIDGETS = join(import.meta.dirname, "widgets")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry) && !/\.test(-support)?\.tsx?$/.test(entry) ? [path] : []
  })
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

  it("the scan sees a dressed drill (the pattern is not vacuous)", () => {
    const dressed = `<Button type="button" variant="outline" size="sm" onClick={go}>
      Open
      <Icon icon={ArrowRight} />
    </Button>`
    expect(DRESSED_DRILL.test(dressed)).toBe(true)
    expect(DRESSED_DRILL.test(`<DrillButton onDrill={go}>Open</DrillButton>`)).toBe(false)
  })
})
