/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { TYPE_FLOOR_PX, TYPE_STEPS } from "../lib/typography.js"
import { HOST_FONT_VARIABLES } from "./host-fonts.js"
import { ROLE_TOKENS } from "./role-tokens.js"
import { TONE_DOT } from "../lib/tone-utils.js"
import {
  BLOCKS,
  COARSE,
  colour,
  COMFORTABLE,
  DARK,
  DARK_KONTRAST,
  DARK_SCOPES,
  fontsCss,
  globalsCss,
  guideRole,
  KONTRAST,
  LIGHT,
  LIGHT_ISLANDS,
  LIGHT_SELECTOR,
  MODES,
  norm,
  painted,
  read,
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
    for (const decls of [ROOT, LIGHT, DARK, KONTRAST, DARK_KONTRAST, COARSE, COMFORTABLE]) {
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
      dense: { px: 13, lineHeight: "1.5", weight: undefined },
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
      "raised",
      "interaction",
      "success-surface",
      "warning-surface",
      "danger-surface",
      "info-surface",
    ]) {
      expect(THEME_INLINE[`--color-${name}`], name).toBe(`var(--${name})`)
    }
  })

  it("carries the guide's --cd-ui-* roles in the neutrals, light AND dark (modeler-tool-design §3.5)", () => {
    const guide: Record<string, string> = {
      "--background": "--cd-ui-grund",
      "--muted": "--cd-ui-grund",
      "--card": "--cd-ui-flaeche",
      "--popover": "--cd-ui-flaeche-hoch",
      "--raised": "--cd-ui-flaeche-hoch",
      "--accent": "--cd-ui-hover",
      "--border": "--cd-ui-linie",
      "--input": "--cd-ui-kontur",
      "--foreground": "--cd-ui-text",
      "--muted-foreground": "--cd-ui-text-leise",
      "--link": "--cd-ui-link",
      "--focus": "--cd-ui-fokus",
      "--ring": "--cd-ui-fokus",
      "--interaction": "--cd-ui-interaktion",
      "--scrim": "--cd-ui-backdrop",
      "--sidebar": "--cd-ui-flaeche",
      "--sidebar-accent": "--cd-ui-hover",
      "--sidebar-border": "--cd-ui-linie",
      ...Object.fromEntries(
        ["success", "warning", "danger", "info"].flatMap((tone) => [
          [`--${tone}`, `--cd-ui-${tone}`],
          [`--${tone}-surface`, `--cd-ui-${tone}-flaeche`],
        ]),
      ),
    }
    for (const mode of MODES) {
      for (const [name, cdUi] of Object.entries(guide)) {
        expect(painted(colour(role(name, mode))), `${name} (${mode}) is ${cdUi}`).toBe(
          painted(guideRole(cdUi, mode)),
        )
      }
    }
  })

  it("names the palette, never a --cd-ui-* role, so a mode the host sets reaches every value", () => {
    // The --cd-ui-* roles switch only under data-cd-theme; .dark and data-theme would keep their light values.
    for (const decls of [ROOT, LIGHT, DARK, KONTRAST, DARK_KONTRAST, COARSE, COMFORTABLE]) {
      for (const value of Object.values(decls)) expect(value).not.toMatch(/--cd-ui-/)
    }
  })

  it("follows the NEAREST mode scope for dark: (dark scope, or a dark scope nested in a light island)", () => {
    const D = `:is(${DARK_SCOPES})`
    const L = `:is(${LIGHT_ISLANDS})`
    expect(rules).toContain(
      `@custom-variant dark (&:is(${D} *:not(${L} *), ${L} ${D} *:not(${L} ${D} ${L} *)));`,
    )
  })

  it("takes the guide's own switch as a mode scope: data-cd-theme, on the same weight as .dark", () => {
    expect(DARK_SCOPES.split(", ")).toEqual([
      ".dark",
      '[data-theme="dark"]',
      '[data-theme-mode="dark"]',
      '[data-cd-theme="dark"]',
    ])
    expect(LIGHT_ISLANDS.split(", ")).toEqual([
      '[data-theme-mode="light"]',
      '[data-cd-theme="light"]',
    ])
  })

  it("re-declares the light roles on a light island only inside a dark scope (a light document keeps a consumer's :root brand)", () => {
    expect(BLOCKS.some((b) => b.selector === LIGHT_SELECTOR)).toBe(true)
    // No rule re-declares roles on EVERY light scope: that would reset a
    // consumer's `:root { --primary: … }` inside each light island.
    for (const b of BLOCKS) {
      const selectors = b.selector.split(/,(?![^(]*\))/).map(norm)
      if (Object.keys(b.decls).some((d) => d.startsWith("--"))) {
        expect(selectors, b.selector).not.toContain('[data-theme-mode="light"]')
        expect(selectors, b.selector).not.toContain('[data-cd-theme="light"]')
      }
    }
  })

  it("declares the dark roles AFTER the light ones (same specificity on <html>: order decides)", () => {
    const light = BLOCKS.find((b) => b.selector === norm(LIGHT_SELECTOR))
    const dark = BLOCKS.find((b) => b.selector === norm(DARK_SCOPES))
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

  it("gives every focusable element an opaque focus outline in --focus, --focus-width wide", () => {
    expect(rules).toMatch(/:focus-visible \{\s*outline: var\(--focus-width\) solid var\(--focus\);/)
    expect(ROOT["--focus-width"]).toBe("2px")
  })

  it("draws high contrast (data-cd-kontrast) without shadows, linie as kontur, the text as edge and quiet text, a 3 px focus", () => {
    for (const shadow of ["--shadow-1", "--shadow-2", "--shadow-3"]) {
      // A box-shadow list Tailwind composes stays valid: `none` in it would drop the focus ring too.
      expect(KONTRAST[shadow], shadow).toBe("0 0 transparent")
    }
    expect(KONTRAST["--focus-width"]).toBe("3px")
    for (const decls of [KONTRAST, DARK_KONTRAST]) {
      expect(decls["--border"]).toBe("var(--cd-kontur)")
      expect(decls["--sidebar-border"]).toBe("var(--cd-kontur)")
    }
    expect(KONTRAST["--input"]).toBe("var(--cd-schwarz)")
    expect(KONTRAST["--muted-foreground"]).toBe("var(--cd-schwarz)")
    expect(DARK_KONTRAST["--input"]).toBe("var(--cd-weiss)")
    expect(DARK_KONTRAST["--muted-foreground"]).toBe("var(--cd-weiss)")
    // The guide's values for the same roles under data-cd-kontrast="hoch".
    const vendored = stripComments(read("../tokens/cd-tokens.generated.css"))
    expect(vendored).toMatch(
      /\[data-cd-kontrast="hoch"\] \{\s*--cd-ui-linie: #8F8A8A;\s*--cd-ui-kontur: #1D1D1D;\s*--cd-ui-text-leise: #1D1D1D;/,
    )
    // The dark contrast block comes after the light one: on <html class="dark"> both match.
    const at = (decls: Record<string, string>) =>
      BLOCKS.find((b) => b.decls === decls)?.offset ?? -1
    expect(at(KONTRAST)).toBeGreaterThan(at(DARK))
    expect(at(DARK_KONTRAST)).toBeGreaterThan(at(KONTRAST))
  })

  it("keeps every state visible under forced colours (Highlight, CanvasText), the light islands as drawn", () => {
    const forced = stripComments(themeCss).slice(
      stripComments(themeCss).indexOf("@media (forced-colors: active)"),
    )
    expect(forced).not.toBe("")
    const css = norm(forced)
    expect(css).toContain(
      ':is([aria-selected="true"], [aria-pressed="true"], [aria-checked="true"], :is(a, button)[aria-current]:not([aria-current="false"])):not(:focus-visible) { outline: 2px solid Highlight; outline-offset: -2px; }',
    )
    expect(css).toContain(
      ':is([data-slot="card"], [data-slot="switch"]) { border-color: CanvasText; }',
    )
    // Every status dot the kit draws (TONE_DOT) turns CanvasText, outside a light island.
    const dots = Object.values(TONE_DOT).map((classes) => `.${classes.split(" ")[0]}`)
    const dotRule =
      /:is\(([^)]*)\):not\(\[data-theme-mode="light"\] \*\) \{ background-color: CanvasText; \}/.exec(
        css,
      )
    expect(dotRule?.[1].split(", ")).toEqual(
      expect.arrayContaining([...dots, '[data-slot="switch-thumb"]']),
    )
    expect(css).toContain('[data-theme-mode="light"] { forced-color-adjust: none; }')
  })

  it("lets a tone's icon follow its surroundings' system colour under forced colours, but in a docked strip or a light island", () => {
    const css = norm(
      stripComments(themeCss).slice(
        stripComments(themeCss).indexOf("@media (forced-colors: active)"),
      ),
    )
    // The browser forces no SVG stroke, and an icon's own tone class (TONE_ICON) would keep it red
    // on the system's canvas: inheriting takes the text's forced colour (CanvasText, ButtonText).
    expect(css).toContain(
      'svg.lucide:not([data-slot="status-strip"] *, [data-theme-mode="light"] *) { color: inherit; }',
    )
  })

  it("sets color-scheme per mode on <body> and the mode scopes, never on <html>", () => {
    const schemes = BLOCKS.filter((b) => "color-scheme" in b.decls)
    const light = schemes.find((b) => b.decls["color-scheme"] === "light")
    const dark = schemes.find((b) => b.decls["color-scheme"] === "dark")
    expect(light?.selector).toBe(`body, :where(body) :is(${LIGHT_ISLANDS})`)
    expect(dark?.selector).toBe(
      `:is(.dark, [data-theme="dark"], [data-cd-theme="dark"]) body, body:is(${DARK_SCOPES}), :where(body) :is(${DARK_SCOPES})`,
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
