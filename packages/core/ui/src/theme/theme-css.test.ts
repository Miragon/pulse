/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { TYPE_FLOOR_PX, TYPE_STEPS } from "../lib/typography.js"
import { HOST_FONT_VARIABLES } from "./host-fonts.js"
import { ROLE_TOKENS } from "./role-tokens.js"
import {
  BLOCKS,
  colour,
  DARK,
  DARK_SELECTOR,
  fontsCss,
  globalsCss,
  LIGHT,
  LIGHT_SELECTOR,
  MODES,
  norm,
  role,
  ROOT,
  rules,
  stripComments,
  THEME_INLINE,
  THEME_REFERENCE,
  themeCss,
} from "./theme-css.test-support.js"

/**
 * The role-token layer (`theme.css`) against its contract: every role defined in light
 * and, for colours, dark, pointing only at the vendored `--cd-*` tokens; the utilities,
 * the type scale and the mode scopes. The contrast over the roles is
 * `theme-contrast.test.ts`.
 */

const COLOUR_ROLES = ROLE_TOKENS.filter((name) => name in LIGHT)

describe("theme.css: the role-token contract", () => {
  it("defines every contract role, each named once", () => {
    for (const name of ROLE_TOKENS) {
      expect(name in LIGHT || name in ROOT, `${name} missing from theme.css`).toBe(true)
    }
    expect(new Set(ROLE_TOKENS).size).toBe(ROLE_TOKENS.length)
  })

  it("defines every colour role for light AND dark", () => {
    expect(COLOUR_ROLES.length).toBeGreaterThanOrEqual(25)
    for (const name of COLOUR_ROLES) {
      expect(name in DARK, `${name} has no dark value`).toBe(true)
    }
  })

  it("points every role at --cd-* tokens only (never at another role; fonts also at the host's font)", () => {
    const hostSlots = new Set<string>(Object.values(HOST_FONT_VARIABLES))
    for (const decls of [ROOT, LIGHT, DARK]) {
      for (const [name, value] of Object.entries(decls)) {
        for (const ref of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
          const target = ref[1]
          if (hostSlots.has(target)) {
            // Only the font role may name the host's font, and only its own slot.
            expect(HOST_FONT_VARIABLES[name as keyof typeof HOST_FONT_VARIABLES], name).toBe(target)
          } else {
            expect(target, `${name}: ${value}`).toMatch(/^--cd-/)
          }
        }
      }
    }
  })

  it("resolves every colour role to a colour from the vendored tokens", () => {
    for (const mode of MODES) {
      for (const name of COLOUR_ROLES) {
        expect(() => colour(role(name, mode)), `${name} (${mode})`).not.toThrow()
      }
    }
  })

  it("maps the self-named utilities (rounded-*, shadow-*, font-*) onto the roles, not calc()", () => {
    for (const name of ["--radius-sm", "--radius-md", "--radius-lg", "--radius-pill"]) {
      expect(THEME_REFERENCE[name], name).toBe(`var(${name})`)
      expect(THEME_INLINE, name).not.toHaveProperty(name)
    }
    for (const name of ["--shadow-1", "--shadow-2", "--shadow-3", "--font-sans", "--font-mono"]) {
      expect(THEME_REFERENCE[name], name).toBe(`var(${name})`)
    }
    for (const value of Object.values(THEME_REFERENCE)) expect(value).not.toContain("calc(")
  })

  it("defines the type scale per CI §4 (page title h2, section h3, body, dense, small) with a 13 px floor", () => {
    const px = (rem: string | undefined) => Number(/^([\d.]+)rem$/.exec(rem ?? "")?.[1]) * 16
    const scale = Object.fromEntries(
      TYPE_STEPS.map((step) => [
        step,
        {
          px: px(ROOT[`--text-${step}`]),
          lineHeight: ROOT[`--text-${step}--line-height`],
          weight: ROOT[`--text-${step}--font-weight`],
        },
      ]),
    )
    expect(scale).toEqual({
      title: { px: 28, lineHeight: "1.2", weight: "700" },
      section: { px: 21, lineHeight: "1.3", weight: "600" },
      body: { px: 16, lineHeight: "1.6", weight: undefined },
      dense: { px: 14, lineHeight: "1.5", weight: undefined },
      small: { px: 13, lineHeight: "1.5", weight: undefined },
    })
    for (const { px: size } of Object.values(scale)) {
      expect(size).toBeGreaterThanOrEqual(TYPE_FLOOR_PX)
    }
    // Mode-independent roles of the contract, themeable like the radii.
    for (const step of TYPE_STEPS) {
      expect(ROLE_TOKENS).toContain(`--text-${step}`)
      expect(LIGHT, step).not.toHaveProperty(`--text-${step}`)
      expect(DARK, step).not.toHaveProperty(`--text-${step}`)
    }
  })

  it("maps the type-scale utilities (text-title … text-small) onto the roles, size, leading and weight", () => {
    for (const step of TYPE_STEPS) {
      expect(THEME_REFERENCE[`--text-${step}`], step).toBe(`var(--text-${step})`)
      expect(THEME_REFERENCE[`--text-${step}--line-height`], step).toBe(
        `var(--text-${step}--line-height)`,
      )
    }
    for (const step of ["title", "section"]) {
      expect(THEME_REFERENCE[`--text-${step}--font-weight`], step).toBe(
        `var(--text-${step}--font-weight)`,
      )
    }
    // Tailwind's own steps stay untouched (text-xs is still 12 px): the floor
    // is a gate on the kit's sources, not a redefinition of a consumer's scale.
    for (const name of Object.keys({ ...THEME_INLINE, ...THEME_REFERENCE })) {
      expect(name).not.toMatch(/^--text-(?:xs|sm|base|lg|\d?xl)\b/)
    }
  })

  it("exposes the new colour roles as utilities (bg-scrim, text-link, ring-focus, text-*-ink, …)", () => {
    for (const name of [
      "link",
      "focus",
      "primary-hover",
      "scrim",
      "destructive-foreground",
      "success-ink",
      "warning-ink",
      "danger-ink",
      "info-ink",
    ]) {
      expect(THEME_INLINE[`--color-${name}`], name).toBe(`var(--${name})`)
    }
  })

  it("follows the NEAREST mode scope for dark: (dark scope, or a dark scope nested in a light island)", () => {
    const D = String.raw`:is\(\.dark, \[data-theme="dark"\], \[data-theme-mode="dark"\]\)`
    const L = String.raw`\[data-theme-mode="light"\]`
    expect(rules).toMatch(
      new RegExp(
        String.raw`@custom-variant dark \(&:is\(${D} \*:not\(${L} \*\), ${L} ${D} \*:not\(${L} ${D} ${L} \*\)\)\);`,
      ),
    )
  })

  it("re-declares the light roles on a light island only inside a dark scope (a light document keeps a consumer's :root brand)", () => {
    expect(BLOCKS.some((b) => b.selector === LIGHT_SELECTOR)).toBe(true)
    // No rule re-declares roles on EVERY light scope: that would reset a
    // consumer's `:root { --primary: … }` inside each light island.
    for (const b of BLOCKS) {
      const selectors = b.selector.split(/,(?![^(]*\))/).map(norm)
      if (Object.keys(b.decls).some((d) => d.startsWith("--"))) {
        expect(selectors, b.selector).not.toContain('[data-theme-mode="light"]')
      }
    }
  })

  it("declares the dark roles AFTER the light ones (same specificity on <html>: order decides)", () => {
    const light = BLOCKS.find((b) => b.selector === norm(LIGHT_SELECTOR))
    const dark = BLOCKS.find((b) => b.selector === norm(DARK_SELECTOR))
    expect(light && dark && light.offset < dark.offset).toBe(true)
  })

  it("forces no font: no font import, no !important font-family, Geist named first", () => {
    for (const css of [themeCss, globalsCss]) {
      const r = stripComments(css)
      expect(r).not.toMatch(/@fontsource/)
      expect(r).not.toMatch(/font-family[^;}]*!important/)
    }
    expect(ROOT["--font-sans"]).toMatch(/^"Geist", /)
    expect(ROOT["--font-mono"]).toMatch(/^"Geist Mono", /)
    // The opt-in file is the only place that loads them.
    expect(stripComments(fontsCss)).toMatch(/@import "@fontsource-variable\/geist\/wght\.css";/)
    expect(stripComments(fontsCss)).toMatch(
      /@import "@fontsource-variable\/geist-mono\/wght\.css";/,
    )
  })

  it("puts the host's font right after Geist and before the system stack", () => {
    expect(ROOT["--font-sans"]).toBe(
      '"Geist", "Geist Variable", var(--host-font-sans, ui-sans-serif), system-ui, sans-serif',
    )
    expect(ROOT["--font-mono"]).toBe(
      '"Geist Mono", "Geist Mono Variable", var(--host-font-mono, ui-monospace), SFMono-Regular, Menlo, Consolas, monospace',
    )
  })

  it("respects prefers-reduced-motion (modeler-tool-design §7)", () => {
    expect(rules).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{\s*animation-duration: 0\.001ms !important;\s*animation-iteration-count: 1 !important;\s*transition-duration: 0\.001ms !important;/,
    )
  })

  it("gives every focusable element an opaque focus outline in --focus", () => {
    expect(rules).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--focus\);/)
  })

  it("sets color-scheme per mode on <body> and the mode scopes, never on <html>", () => {
    const schemes = BLOCKS.filter((b) => "color-scheme" in b.decls)
    const light = schemes.find((b) => b.decls["color-scheme"] === "light")
    const dark = schemes.find((b) => b.decls["color-scheme"] === "dark")
    expect(light?.selector).toBe('body, :where(body) [data-theme-mode="light"]')
    expect(dark?.selector).toBe(
      ':is(.dark, [data-theme="dark"]) body, body:is(.dark, [data-theme="dark"], [data-theme-mode="dark"]), :where(body) :is(.dark, [data-theme="dark"], [data-theme-mode="dark"])',
    )
    // A root color-scheme that differs from the host's iframe paints an opaque
    // canvas behind the view; the host keeps it transparent on purpose.
    for (const b of BLOCKS) {
      if (b.selector.includes(":root") || /(^|[\s,])html\b/.test(b.selector)) {
        expect(b.decls, b.selector).not.toHaveProperty("color-scheme")
      }
    }
  })

  it("is what globals.css loads, after Tailwind, with the vendored tokens and the compiled sources", () => {
    const g = stripComments(globalsCss)
    expect(g.indexOf('@import "tailwindcss";')).toBeGreaterThanOrEqual(0)
    expect(g.indexOf('@import "./theme.css";')).toBeGreaterThan(g.indexOf('@import "tailwindcss";'))
    // The package ships only its CSS from src/: Tailwind reads the class strings in dist/,
    // where the tarball carries no tests (package.json `files`), so no fixture class leaks in.
    expect(g).toContain('@source "../dist";')
    expect(g).not.toContain("@source not")
    expect(rules).toContain('@import "./tokens/cd-tokens.generated.css";')
  })
})
