import { describe, expect, it } from "vitest"
import { DENSITY_CELL_PADDING, DENSITY_RADIUS, DENSITY_SPACING } from "../lib/density.js"
import { DENSITY_ROLES, ROLE_TOKENS } from "./role-tokens.js"
import {
  cdToken,
  BLOCKS,
  COARSE,
  COMFORTABLE,
  COMPACT,
  DARK,
  DARK_KONTRAST,
  KONTRAST,
  LIGHT,
  norm,
  ROOT,
  rules,
  THEME_INLINE,
  THEME_REFERENCE,
} from "./theme-css.test-support.js"

/**
 * The density roles of `theme.css` (D9, `apps/vscode/docs/adr/ui-foundation.md`): compact by
 * default on every surface, in rem on the guide's shell ladder, the comfortable step on a coarse
 * pointer and under `data-density="comfortable"`; their utility keys. The colour roles are
 * `theme-css.test.ts`.
 */

/** A rem length at a 16 px root, in px. */
const remPx = (value: string | undefined) => {
  const rem = /^(\d+(?:\.\d+)?)rem$/.exec(value ?? "")
  if (!rem) throw new Error(`not a rem length: ${value}`)
  return Number(rem[1]) * 16
}

type ShellToken = `--cd-shell-${"zeile" | "eintrag" | "ziel" | "rand"}`
/** A density step: a shell token of the guide, or a value of its own, named with its reason. */
type Step = ShellToken | { px: number; named: string }
type LengthRole = Exclude<(typeof DENSITY_ROLES)[number], "--button-radius">

/** Each length role at a 16 px root: compact, then comfortable. */
const STEPS: Record<LengthRole, [compact: Step, comfortable: Step]> = {
  "--bar-h": ["--cd-shell-zeile", { px: 48, named: "a 36 px target with 6 px above and below" }],
  "--toolbar-h": ["--cd-shell-eintrag", "--cd-shell-zeile"],
  "--entry-h": ["--cd-shell-eintrag", "--cd-shell-zeile"],
  "--control-h": [
    { px: 28, named: "no shell token: the compact control, a deviation CLAUDE.md names" },
    "--cd-shell-eintrag",
  ],
  "--control-h-xs": [
    { px: 24, named: "the xs control, a deviation CLAUDE.md names; WCAG 2.5.8's 24 px target" },
    "--cd-shell-ziel",
  ],
  "--control-h-lg": ["--cd-shell-eintrag", "--cd-shell-zeile"],
  "--row-h": [
    { px: 28, named: "no shell token: the compact row, a deviation CLAUDE.md names" },
    "--cd-shell-zeile",
  ],
  "--cell-px": ["--cd-shell-rand", "--cd-shell-rand"],
  "--cell-py": [
    { px: 4, named: "a line of dense text in a 28 px row" },
    { px: 8, named: "the comfortable cell's inset" },
  ],
  "--gutter": ["--cd-shell-rand", { px: 16, named: "the comfortable gutter" }],
  "--section-gap": ["--cd-shell-rand", { px: 16, named: "the comfortable gap" }],
  "--segment-h": [{ px: 24, named: "a segment inside a 28 px control" }, "--cd-shell-ziel"],
  "--badge-h": [
    { px: 20, named: "a count badge, no target" },
    { px: 20, named: "the same in both steps" },
  ],
}

function stepPx(step: Step): number {
  if (typeof step !== "string") return step.px
  const shell = /^(\d+)px$/.exec(cdToken(step))
  if (!shell) throw new Error(`${step} is no px length: ${cdToken(step)}`)
  return Number(shell[1])
}

const LENGTH_ROLES = Object.keys(STEPS) as LengthRole[]

describe("theme.css: the density roles (D9: compact by default, comfortable on touch)", () => {
  it("defines every density role once, in :root, mode-independent, the lengths in rem", () => {
    expect([...LENGTH_ROLES, "--button-radius"].sort()).toEqual([...DENSITY_ROLES].sort())
    for (const name of DENSITY_ROLES) {
      expect(ROLE_TOKENS, name).toContain(name)
      expect(ROOT, name).toHaveProperty(name)
      for (const decls of [LIGHT, DARK, KONTRAST, DARK_KONTRAST]) {
        expect(decls, name).not.toHaveProperty(name)
      }
    }
    for (const name of LENGTH_ROLES) expect(() => remPx(ROOT[name]), name).not.toThrow()
  })

  it("holds the compact step to the guide's shell tokens at a 16 px root, each other value named", () => {
    for (const name of LENGTH_ROLES) {
      const [compact] = STEPS[name]
      expect(remPx(ROOT[name]), `${name}: ${JSON.stringify(compact)}`).toBe(stepPx(compact))
    }
    // The shell ladder as the guide vendors it: zeile 40, eintrag 36, ziel 32, rand 12.
    expect(
      (["zeile", "eintrag", "ziel", "rand"] as const).map((step) => stepPx(`--cd-shell-${step}`)),
    ).toEqual([40, 36, 32, 12])
  })

  it("takes the comfortable step on a coarse pointer and under data-density=comfortable, the same values", () => {
    expect(COMFORTABLE).toEqual(COARSE)
    for (const name of Object.keys(COARSE)) expect(DENSITY_ROLES, name).toContain(name)
    for (const name of LENGTH_ROLES) {
      const [, comfortable] = STEPS[name]
      const value = COARSE[name] ?? ROOT[name]
      expect(remPx(value), `${name}: ${JSON.stringify(comfortable)}`).toBe(stepPx(comfortable))
    }
    expect(rules).toMatch(/@media \(any-pointer: coarse\) \{\s*:root \{/)
  })

  it("lets a host pin the compact step on a coarse pointer, and a nearer comfortable mark win over it", () => {
    // Every role the comfortable step changes, back at its compact value.
    const pinned = Object.fromEntries(Object.keys(COARSE).map((name) => [name, ROOT[name]]))
    expect(COMPACT).toEqual(pinned)
    // Each mark after the media block: the same specificity as :root, so the later rule wins
    // on <html> and the nearest mark wins below it.
    const at = (selector: string) => BLOCKS.findIndex((b) => b.selector === selector)
    const coarse = rules.indexOf("@media (any-pointer: coarse)")
    const compact = BLOCKS[at('[data-density="compact"]')]?.offset ?? -1
    const comfortable = BLOCKS[at('[data-density="comfortable"]')]?.offset ?? -1
    expect(coarse).toBeGreaterThan(0)
    expect(compact).toBeGreaterThan(coarse)
    expect(comfortable).toBeGreaterThan(compact)
  })

  it("rounds a button with the sm radius in the compact step and the md radius in the comfortable one", () => {
    expect(ROOT["--button-radius"]).toBe("var(--cd-radius-sm)")
    expect(COARSE["--button-radius"]).toBe("var(--cd-radius-md)")
  })

  it("exposes each density role as one utility key: spacing, the cell's two axes, the button radius", () => {
    const keyed = [
      ...Object.values(DENSITY_SPACING),
      ...Object.values(DENSITY_CELL_PADDING),
      ...Object.values(DENSITY_RADIUS),
    ]
    expect(keyed.sort()).toEqual([...DENSITY_ROLES].sort())
    for (const [key, role] of Object.entries(DENSITY_SPACING)) {
      expect(THEME_REFERENCE[`--spacing-${key}`], key).toBe(`var(${role})`)
    }
    for (const [key, role] of Object.entries(DENSITY_RADIUS)) {
      expect(THEME_REFERENCE[`--radius-${key}`], key).toBe(`var(${role})`)
    }
    // Every spacing key of the theme is one cn knows (src/lib/density.ts).
    const spacing = Object.keys({ ...THEME_INLINE, ...THEME_REFERENCE })
      .filter((name) => name.startsWith("--spacing-"))
      .map((name) => name.slice("--spacing-".length))
    expect(spacing.sort()).toEqual(Object.keys(DENSITY_SPACING).sort())
    const css = norm(rules)
    for (const [axis, role] of Object.entries(DENSITY_CELL_PADDING)) {
      const side = axis === "px" ? "inline" : "block"
      expect(css, axis).toContain(`@utility ${axis}-cell { padding-${side}: var(${role}); }`)
    }
  })
})
