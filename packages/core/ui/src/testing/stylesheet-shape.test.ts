import { describe, expect, it } from "vitest"
import { stylesheetRules, stylesheetShapeFindings } from "./stylesheet-shape.js"

// Raw colours and forced fonts are the test data here (closed at the end).
/* brand-lint-disable */

const SHAPED = [
  '@import "tailwindcss";',
  "/* html { min-height: 100vh } and --cd-blau: #fff are fine in a comment */",
  '@import "@miragon/pulse-ui/theme.css";',
  ":root { --primary: var(--cd-blau); }",
  "#root { display: contents; }",
  ".card { min-height: 4rem; }",
].join("\n")

describe("stylesheetShapeFindings: a stylesheet every view inlines keeps the view's shape", () => {
  it("passes a stylesheet that overrides role variables only, comments aside", () => {
    expect(stylesheetShapeFindings(SHAPED, "globals.css")).toEqual([])
  })

  it.each([
    ["html, body { min-height: 600px; }", "a min-height floor on html, body or #root"],
    ['@import "x.css";\n#root{min-height:100vh}', "a min-height floor on html, body or #root"],
    ["body { font-family: Geist !important; }", "a forced font"],
    ['@import "@fontsource-variable/geist";', "an inlined font"],
    ['@import "@miragon/pulse-ui/fonts.css";', "an inlined font"],
    ['@font-face { font-family: X; src: url("x.woff2"); }', "an inlined font"],
    [":root { --cd-blau: var(--primary); }", "declares a --cd-* token"],
    [":root { --m-blue-dark: var(--primary); }", "declares a retired accent"],
    [".x { color: #123456; }", "a raw colour or retired accent, #123456"],
  ])("%s: %s", (css, finding) => {
    const findings = stylesheetShapeFindings(css, "brand.css")
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatch(/^brand\.css(?::\d+)?: /)
    expect(findings[0]).toContain(finding)
  })

  it("names the rule that sets the floor, without the statements in front of it", () => {
    expect(
      stylesheetShapeFindings('@import "x.css";\nhtml,\nbody {\n  min-height: 100vh;\n}', "a.css"),
    ).toEqual([
      "a.css: a min-height floor on html, body or #root: html,\nbody { min-height: 100vh; }",
    ])
  })

  it("blanks comments in place, so offsets and lines stay true", () => {
    const css = "/* a */\n@import x;"
    expect(stylesheetRules(css)).toBe("       \n@import x;")
  })
})

/* brand-lint-enable */
