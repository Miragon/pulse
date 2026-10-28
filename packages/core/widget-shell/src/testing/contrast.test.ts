import { describe, expect, it } from "vitest"
import {
  composite,
  contrastFindings,
  contrastRatio,
  measureContrast,
  parseThemeVariables,
  resolveColor,
  toolkitThemeStylesheets,
} from "./contrast.js"

// Fixtures: CI token values and synthetic colours are test data, not UI colours.
/* brand-lint-disable */

const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const hex = (c: { r: number; g: number; b: number }) =>
  "#" +
  [c.r, c.g, c.b]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a colour on itself, in either order", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5)
    expect(contrastRatio(WHITE, WHITE)).toBe(1)
  })

  it("matches the CI's published pairs (corporate-design contrast.json)", () => {
    const vars = new Map<string, string>()
    // blau-link on white 6.56, text-leise on white 5.65, gruen on schwarz 10.1
    expect(contrastRatio(resolveColor("#2B50D4", vars), WHITE)).toBeCloseTo(6.56, 1)
    expect(contrastRatio(resolveColor("#6B6666", vars), WHITE)).toBeCloseTo(5.65, 1)
    expect(contrastRatio(resolveColor("#00E676", vars), resolveColor("#1D1D1D", vars))).toBeCloseTo(
      10.1,
      1,
    )
  })
})

describe("resolveColor", () => {
  const vars = new Map([
    ["--a", "#ff0000"],
    ["--b", "var(--a)"],
    ["--loop", "var(--loop)"],
    ["--mix", "color-mix(in srgb, var(--a) 50%, white)"],
  ])

  it("reads #rgb, #rrggbb and #rrggbbaa", () => {
    expect(resolveColor("#fff", vars)).toEqual(WHITE)
    expect(hex(resolveColor("#335DE5", vars))).toBe("#335de5")
    expect(resolveColor("#00000080", vars).a).toBeCloseTo(0.5, 2)
  })

  it("follows var() chains and falls back when a variable is missing", () => {
    expect(hex(resolveColor("var(--b)", vars))).toBe("#ff0000")
    expect(resolveColor("var(--missing, white)", vars)).toEqual(WHITE)
    expect(() => resolveColor("var(--missing)", vars)).toThrow(/Undefined theme variable --missing/)
    expect(() => resolveColor("var(--loop)", vars)).toThrow(/Circular/)
  })

  it("converts oklch the way the browser does, alpha included", () => {
    expect(hex(resolveColor("oklch(1 0 0)", vars))).toBe("#ffffff")
    expect(hex(resolveColor("oklch(0.145 0 0)", vars))).toBe("#0a0a0a")
    expect(hex(resolveColor("oklch(0.55 0.21 27.3)", vars))).toBe("#d01d20")
    expect(resolveColor("oklch(0.7 0.19 22.2 / 18%)", vars).a).toBeCloseTo(0.18, 5)
    expect(resolveColor("oklch(1 0 0 / 0.1)", vars).a).toBeCloseTo(0.1, 5)
  })

  it("mixes in srgb and oklab, with transparent and implied weights", () => {
    expect(hex(resolveColor("var(--mix)", vars))).toBe("#ff8080")
    expect(hex(resolveColor("color-mix(in srgb, black, white)", vars))).toBe("#808080")
    expect(hex(resolveColor("color-mix(in srgb, black 25%, white)", vars))).toBe("#bfbfbf")
    expect(hex(resolveColor("color-mix(in srgb, black, white 25%)", vars))).toBe("#404040")
    const faded = resolveColor("color-mix(in oklab, #ff0000 90%, transparent)", vars)
    expect(faded.a).toBeCloseTo(0.9, 5)
    expect(hex(faded)).toBe("#ff0000")
    expect(resolveColor("color-mix(in srgb, transparent, transparent)", vars).a).toBe(0)
    expect(hex(resolveColor("color-mix(in oklab, black 50%, white 50%)", vars))).toBe("#636363")
  })

  it("knows the named colours it needs and rejects every other shape", () => {
    expect(resolveColor("black", vars)).toEqual(BLACK)
    expect(resolveColor("transparent", vars).a).toBe(0)
    expect(() => resolveColor("rgb(1 2 3)", vars)).toThrow(/Unsupported colour value: rgb/)
  })
})

describe("hostile input stays linear (CodeQL js/polynomial-redos)", () => {
  it("reads a var() with a long whitespace run without backtracking", () => {
    const vars = new Map([["--x", "#ffffff"]])
    const started = performance.now()
    expect(resolveColor(`var(--x,${" ".repeat(100_000)}#000)`, vars)).toEqual(WHITE)
    expect(() => resolveColor(`var(---,${" ".repeat(100_000)}`, vars)).toThrow()
    expect(performance.now() - started).toBeLessThan(500)
  })

  it("reads a block full of dashes without backtracking", () => {
    const started = performance.now()
    const vars = parseThemeVariables(`:root { ${"--".repeat(100_000)} }\n:root { --ink: #111111; }`)
    expect(vars.light.get("--ink")).toBe("#111111")
    expect(performance.now() - started).toBeLessThan(500)
  })

  it("strips many unterminated comment openers in linear time", () => {
    const started = performance.now()
    const vars = parseThemeVariables(`:root { --ink: #111111; }\n/*${"a/*".repeat(100_000)}`)
    expect(vars.light.get("--ink")).toBe("#111111")
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe("composite", () => {
  it("paints a translucent colour over an opaque one", () => {
    expect(composite({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 })
    expect(composite(BLACK, WHITE)).toEqual(BLACK)
  })
})

describe("parseThemeVariables", () => {
  const css = `
@import "x";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-ink: var(--ink);
}
/* :root { --ink: #00ff00; } a comment never counts */
:root {
  --ink: #111111;
  --page: #ffffff;
}
.dark {
  --ink: #eeeeee;
}
.other, :root { --page: #fafafa; }
@layer base {
  * { color: red; }
}
`
  const theme = parseThemeVariables(css)

  it("reads :root (+ @theme) for light and lays .dark on top for dark", () => {
    expect(theme.light.get("--ink")).toBe("#111111")
    expect(theme.dark.get("--ink")).toBe("#eeeeee")
    expect(theme.light.get("--color-ink")).toBe("var(--ink)")
    expect(theme.dark.get("--page")).toBe("#fafafa")
  })

  it("lets a later stylesheet override an earlier one (a consumer's brand layer)", () => {
    const branded = parseThemeVariables(css, ":root { --ink: #222222; } .dark { --ink: #dddddd; }")
    expect(branded.light.get("--ink")).toBe("#222222")
    expect(branded.dark.get("--ink")).toBe("#dddddd")
  })

  it("models html.dark as the browser does: :root and .dark in source order, later wins", () => {
    // :root and .dark match <html> with the same specificity: a later light-only :root
    // reaches dark too; a later .dark still beats an earlier :root.
    const lightOnly = parseThemeVariables(css, ":root { --ink: #222222; }")
    expect(lightOnly.light.get("--ink")).toBe("#222222")
    expect(lightOnly.dark.get("--ink")).toBe("#222222")
    const inOneSheet = parseThemeVariables(
      ".dark { --a: #000001; } :root { --a: #000002; --b: #000003; } .dark { --b: #000004; }",
    )
    expect(inOneSheet.dark.get("--a")).toBe("#000002")
    expect(inOneSheet.dark.get("--b")).toBe("#000004")
    expect(inOneSheet.light.get("--a")).toBe("#000002")
    expect(inOneSheet.light.get("--b")).toBe("#000003")
  })

  it("keeps @theme registrations below every :root/.dark rule (Tailwind's theme layer)", () => {
    const layered = parseThemeVariables(":root { --x: #000001; } @theme { --x: #000002; }")
    expect(layered.light.get("--x")).toBe("#000001")
    expect(layered.dark.get("--x")).toBe("#000001")
  })

  it("ignores descendant scopes and rules without custom properties", () => {
    const scoped = parseThemeVariables(
      ":root { --x: #000001; } .dark .card { --x: #000002; } .card { --x: #000003; } @layer base { html, body { color: red; } } @media (min-width: 1px) { .card { --x: #000004; } }",
    )
    expect(scoped.light.get("--x")).toBe("#000001")
    expect(scoped.dark.get("--x")).toBe("#000001")
  })

  it("models the toolkit's dark scopes on <html> and skips its light islands", () => {
    // Like the toolkit's theme.css: a light island nested in a dark scope, three dark scopes.
    const toolkitShaped = parseThemeVariables(
      ':root, :where(.dark, [data-theme="dark"], [data-theme-mode="dark"]) [data-theme-mode="light"] { --x: #000001; }',
      '.dark, [data-theme="dark"], [data-theme-mode="dark"] { --x: #000002; }',
    )
    expect(toolkitShaped.light.get("--x")).toBe("#000001")
    expect(toolkitShaped.dark.get("--x")).toBe("#000002")
    for (const scope of ["[data-theme='dark']", '[data-theme-mode="dark"]']) {
      const single = parseThemeVariables(":root { --x: #000001; }", `${scope} { --x: #000002; }`)
      expect(single.light.get("--x")).toBe("#000001")
      expect(single.dark.get("--x")).toBe("#000002")
    }
  })

  it("reads the toolkit's Miragon theme as shipped: vendored tokens, then the role layer", () => {
    const shipped = toolkitThemeStylesheets()
    expect(shipped).toHaveLength(2)
    expect(shipped[0]).toMatch(/--cd-blau:/)
    expect(shipped[1]).toMatch(/@import "\.\/theme\/cd-tokens\.generated\.css"/)
    const miragon = parseThemeVariables(...shipped)
    const rgb = (name: string, mode: "light" | "dark") => {
      const { r, g, b } = resolveColor(`var(${name})`, miragon[mode])
      return [r, g, b].map((c) => Math.round(c * 255)).join(",")
    }
    // --primary is --cd-blau (#335DE5) in both modes; the ground flips.
    expect(rgb("--primary", "light")).toBe("51,93,229")
    expect(rgb("--primary", "dark")).toBe("51,93,229")
    expect(rgb("--background", "light")).toBe("255,255,255")
    expect(rgb("--background", "dark")).toBe("29,29,29")
  })

  it.each([
    ["html.dark { --x: #000000; }"],
    [":root.dark { --x: #000000; }"],
    ['[data-theme="light"] { --x: #000000; }'],
    [":root:not(.light) { --x: #000000; }"],
    ["html { --x: #000000; }"],
    ["@media (prefers-color-scheme: dark) { :root { --x: #000000; } }"],
    ["@layer base { :root { --x: #000000; } }"],
  ])("throws on a theme rule it cannot model: %s", (rule) => {
    expect(() => parseThemeVariables(":root { --x: #ffffff; }", rule)).toThrow(
      /Unsupported theme rule/,
    )
  })

  it("throws on unbalanced braces instead of measuring garbage", () => {
    expect(() => parseThemeVariables(":root { --x: #000000;")).toThrow(/Unbalanced/)
    expect(() => parseThemeVariables(":root { --x: #000000; } }")).toThrow(/Unbalanced/)
  })

  it("measures pairs per mode and reports the misses", () => {
    const pairs = [
      { label: "ink on page", fg: "--color-ink", bg: "--page", over: "--page", min: 4.5 },
      { label: "ink as an edge", fg: "--ink", bg: "--page", over: "--page", min: 30 },
    ]
    const results = measureContrast(theme, pairs)
    expect(results.map((r) => `${r.mode}:${r.label}`)).toEqual([
      "light:ink on page",
      "light:ink as an edge",
      "dark:ink on page",
      "dark:ink as an edge",
    ])
    expect(results[0].ratio).toBeGreaterThan(15)
    expect(results[2].ratio).toBeLessThan(1.2)
    expect(contrastFindings(theme, pairs)).toEqual([
      "light: ink as an edge",
      "dark: ink on page",
      "dark: ink as an edge",
    ])
  })

  it("paints a translucent background over the given surface (default: card)", () => {
    const glass = parseThemeVariables(
      ":root { --card: #000000; --page: #ffffff; --veil: #ffffff00; --text: #ffffff; }",
    )
    const [onCard] = measureContrast(glass, [
      { label: "text on veil", fg: "--text", bg: "--veil", min: 4.5 },
    ])
    const [onPage] = measureContrast(glass, [
      { label: "text on veil", fg: "--text", bg: "--veil", over: "--page", min: 4.5 },
    ])
    expect(onCard.ratio).toBeCloseTo(21, 5)
    expect(onPage.ratio).toBe(1)
  })
})

/* brand-lint-enable */
