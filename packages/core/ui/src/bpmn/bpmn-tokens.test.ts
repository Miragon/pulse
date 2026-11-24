// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { LINK_STYLES } from "bpmn-js/lib/util/PoweredByUtil"
import { CD_TOKENS, ROLE_TOKENS, type CdTokenName } from "../index.js"
import {
  composite,
  contrastRatio,
  parseThemeVariables,
  resolveColor,
  themeStylesheets,
  type Rgba,
} from "../testing/index.js"
import {
  BPMN_CANVAS_ROLES,
  BPMN_CANVAS_SLOT,
  BPMN_CANVAS_VARS,
  BPMN_DARK_CANVAS,
  BPMN_FORCED_CANVAS,
  BPMN_HIGH_CONTRAST,
  BPMN_OVERLAY_CSS,
  BPMN_RENDERER_COLORS,
  BPMN_TOKENS,
  cdVar,
} from "./bpmn-tokens.js"

/** Every `--cd-*` token name the module uses. */
function tokenNames(value: unknown): CdTokenName[] {
  if (typeof value === "string") return [value as CdTokenName]
  return Object.values(value as Record<string, unknown>).flatMap(tokenNames)
}

const USED = [...new Set(tokenNames(BPMN_TOKENS))]
const [TOKENS_CSS, THEME_CSS] = themeStylesheets()

/** The vendored corporate-design stylesheet, as pulse-ui ships it (the tokens come first). */
function vendoredTokens(): Map<string, string> {
  return new Map(
    [...TOKENS_CSS.matchAll(/--cd-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  )
}

/** The guide's dark `--cd-ui-*` roles as the vendored tokens declare them: what the webview paints. */
function guideDarkRoles(): Map<string, string> {
  const block = /\[data-cd-theme="dark"\]\s*\{([^}]*)\}/.exec(TOKENS_CSS)?.[1] ?? ""
  return new Map(
    [...block.matchAll(/(--cd-ui-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  )
}

type Mode = "light" | "dark"
const THEME = parseThemeVariables(...themeStylesheets())

/** pulse-ui's theme in a mode with the canvas's own variables declared over it, as on its frame. */
function canvasScope(mode: Mode): Map<string, string> {
  return new Map([...THEME[mode], ...Object.entries(BPMN_CANVAS_ROLES[mode])])
}

const OPAQUE_WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 }
/** A colour as the canvas paints it: opaque, a translucent role over the paper. */
function paint(value: string, mode: Mode): Rgba {
  const scope = canvasScope(mode)
  const paper = composite(resolveColor(`var(${BPMN_CANVAS_VARS.paper})`, scope), OPAQUE_WHITE)
  return composite(resolveColor(value, scope), paper)
}
const V = (name: keyof typeof BPMN_CANVAS_VARS) => `var(${BPMN_CANVAS_VARS[name]})`
const ratio = (a: string, b: string, mode: Mode) => contrastRatio(paint(a, mode), paint(b, mode))

const byte = (x: number) => Math.round(x * 255)
const bytes = ({ r, g, b }: Rgba) => [byte(r), byte(g), byte(b)]

/** A rule of the overlay CSS: its selectors (split at the top-level commas), its media and body. */
interface CssRule {
  media: string | null
  selectors: string[]
  body: string
}

/** Splits a selector list at its top-level commas (not those inside `:is()` or `:not()`). */
function selectorList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === "(") depth++
    else if (c === ")") depth--
    else if (c === "," && depth === 0) {
      parts.push(selector.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts
}

/** The overlay CSS's rules, each `@media` block's with its condition (it nests one level). */
function cssRules(css: string, media: string | null = null): CssRule[] {
  const rules: CssRule[] = []
  let at = 0
  for (let open = css.indexOf("{", at); open !== -1; open = css.indexOf("{", at)) {
    let depth = 1
    let close = open + 1
    for (; depth > 0; close++) {
      if (css[close] === "{") depth++
      else if (css[close] === "}") depth--
    }
    const selector = css.slice(at, open).trim()
    const body = css.slice(open + 1, close - 1)
    if (selector.startsWith("@media")) rules.push(...cssRules(body, selector))
    else rules.push({ media, selectors: selectorList(selector), body })
    at = close
  }
  return rules
}

const RULES = cssRules(BPMN_OVERLAY_CSS)
const FORCED = "@media (forced-colors: active)"
const FORCED_DARK = "@media (forced-colors: active) and (prefers-color-scheme: dark)"

/** The declarations of the rules whose selectors include `selector`, under `media`. */
function declarations(selector: string, media: string | null): Map<string, string> {
  const found = new Map<string, string>()
  for (const rule of RULES.filter((r) => r.media === media && r.selectors.includes(selector))) {
    for (const [, name, value] of rule.body.matchAll(/([\w-]+):\s*([^;]+);/g))
      found.set(name, value.trim())
  }
  return found
}

describe("BPMN token module ↔ the vendored CSS (modeler-tool-design §13 drift test)", () => {
  it("names only tokens the vendored stylesheet defines, with the same value as CD_TOKENS", () => {
    const css = vendoredTokens()
    expect(USED.length).toBeGreaterThan(0)
    for (const name of USED) {
      expect(css.get(name), `--cd-${name}`).toBeDefined()
      expect(CD_TOKENS[name].toLowerCase(), `--cd-${name}`).toBe(css.get(name)?.toLowerCase())
    }
  })

  it("the overlay CSS refers to tokens, pulse-ui's roles and its own variables: no raw colour", () => {
    expect(BPMN_OVERLAY_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
    const css = vendoredTokens()
    const roles = new Set<string>(ROLE_TOKENS)
    const own = new Set<string>(Object.values(BPMN_CANVAS_VARS))
    for (const [, name] of BPMN_OVERLAY_CSS.matchAll(/var\((--[\w-]+)\)/g)) {
      const known = name.startsWith("--cd-") ? css.has(name.slice(5)) : roles.has(name)
      expect(known || own.has(name), name).toBe(true)
    }
  })

  it("every marker paints in the canvas's variables, which each mode declares", () => {
    const markers = [
      ["highlight-running", "runningFill", "runningStroke"],
      ["highlight-open-user-task", "openTaskFill", "openTaskStroke"],
      ["highlight-incident", "incidentFill", "incidentStroke"],
    ] as const
    for (const [marker, fill, stroke] of markers) {
      const rule = new RegExp(`${marker}[^{]*\\{([^}]*)\\}`).exec(BPMN_OVERLAY_CSS)?.[1] ?? ""
      expect(rule, marker).toContain(`fill: ${V(fill)} !important`)
      expect(rule, marker).toContain(`stroke: ${V(stroke)} !important`)
    }
    for (const mode of ["light", "dark"] as const) {
      expect(Object.keys(BPMN_CANVAS_ROLES[mode]).sort()).toEqual(
        Object.values(BPMN_CANVAS_VARS).sort(),
      )
    }
  })

  it("red only for incidents; running and active blue on the info tint", () => {
    expect(BPMN_TOKENS.incident).toEqual({ stroke: "danger", fill: "danger-soft" })
    expect(BPMN_TOKENS.incidentBadge.fill).toBe("danger")
    expect(BPMN_TOKENS.running).toEqual({ stroke: "blau", fill: "info-soft" })
    expect(BPMN_TOKENS.openTask).toEqual({ stroke: "blau", fill: "info-soft" })
    expect(BPMN_TOKENS.instanceBadge.fill).toBe("blau")
    expect(BPMN_TOKENS.heat).toEqual({ from: "info-soft", to: "blau" })
    const danger = new Set<CdTokenName>(["danger", "danger-soft", "danger-hell"])
    const nonIncident = [
      BPMN_TOKENS.running,
      BPMN_TOKENS.openTask,
      BPMN_TOKENS.instanceBadge,
      BPMN_TOKENS.heat,
    ]
    for (const name of tokenNames(nonIncident)) expect(danger.has(name)).toBe(false)
    const dark = BPMN_CANVAS_ROLES.dark
    for (const name of ["runningStroke", "runningFill", "openTaskStroke", "openTaskFill"] as const)
      expect(dark[BPMN_CANVAS_VARS[name]]).not.toMatch(/danger/)
    expect(dark[BPMN_CANVAS_VARS.heatTo]).toBe(cdVar("blau"))
  })

  it("an open task stands still: a dashed stroke, no animation (prefers-reduced-motion)", () => {
    expect(BPMN_OVERLAY_CSS).not.toMatch(/animation|@keyframes|transition/)
    expect(BPMN_OVERLAY_CSS).toMatch(/highlight-open-user-task[^}]*stroke-dasharray/)
  })
})

describe("the canvas follows the theme (owner decision D10, point 7)", () => {
  it("bpmn-js draws with the canvas's paper and ink, never its own white and near-black", () => {
    expect(BPMN_RENDERER_COLORS).toEqual({
      defaultFillColor: V("paper"),
      defaultStrokeColor: V("ink"),
      defaultLabelColor: V("ink"),
    })
  })

  it("light: the paper, the markers and the heat of the chat's light canvas, the guide's text as ink", () => {
    expect(BPMN_CANVAS_ROLES.light).toEqual({
      [BPMN_CANVAS_VARS.paper]: cdVar("weiss"),
      [BPMN_CANVAS_VARS.ink]: cdVar("schwarz"),
      [BPMN_CANVAS_VARS.incidentStroke]: cdVar("danger"),
      [BPMN_CANVAS_VARS.incidentFill]: cdVar("danger-soft"),
      [BPMN_CANVAS_VARS.runningStroke]: cdVar("blau"),
      [BPMN_CANVAS_VARS.runningFill]: cdVar("info-soft"),
      [BPMN_CANVAS_VARS.openTaskStroke]: cdVar("blau"),
      [BPMN_CANVAS_VARS.openTaskFill]: cdVar("info-soft"),
      [BPMN_CANVAS_VARS.badgeShadow]: "var(--cd-shadow-1)",
      [BPMN_CANVAS_VARS.heatFrom]: cdVar("info-soft"),
      [BPMN_CANVAS_VARS.heatTo]: cdVar("blau"),
      [BPMN_CANVAS_VARS.heatBlend]: "multiply",
    })
  })

  it("dark: pulse-ui's roles, the webview's dark canvas value by value (the guide's --cd-ui-* roles)", () => {
    const guide = guideDarkRoles()
    const webview = (role: string) => {
      const value = guide.get(role)
      expect(value, role).toBeDefined()
      return bytes(resolveColor(value ?? "", new Map()))
    }
    const drawn = (name: keyof typeof BPMN_CANVAS_VARS) => bytes(paint(V(name), "dark"))
    expect(drawn("paper")).toEqual(webview("--cd-ui-grund"))
    expect(drawn("paper")).toEqual(webview("--cd-ui-plot"))
    expect(drawn("ink")).toEqual(webview("--cd-ui-text"))
    expect(drawn("incidentStroke")).toEqual(webview("--cd-ui-danger"))
    expect(drawn("incidentFill")).toEqual(webview("--cd-ui-danger-flaeche"))
    expect(drawn("runningStroke")).toEqual(webview("--cd-ui-info"))
    expect(drawn("runningFill")).toEqual(webview("--cd-ui-info-flaeche"))
    expect(drawn("openTaskStroke")).toEqual(webview("--cd-ui-info"))
    expect(drawn("openTaskFill")).toEqual(webview("--cd-ui-info-flaeche"))
    // bpmn.io's link in the quiet text, as the webview draws it.
    const credit = /\.bjs-powered-by \{\s*color: (var\([\w-]+\)) !important;/.exec(
      BPMN_OVERLAY_CSS,
    )?.[1]
    expect(bytes(paint(credit ?? "", "dark"))).toEqual(webview("--cd-ui-text-leise"))
    for (const value of Object.values(BPMN_CANVAS_ROLES.dark)) {
      for (const [, name] of value.matchAll(/var\((--[\w-]+)\)/g)) {
        const allowed =
          ROLE_TOKENS.includes(name as never) ||
          name.startsWith("--cd-") ||
          name === BPMN_CANVAS_VARS.paper
        expect(allowed, name).toBe(true)
      }
    }
  })

  it("declares the light variables on the canvas, the dark ones where its nearest mode scope is dark", () => {
    const blocks = new Map(
      [...BPMN_OVERLAY_CSS.matchAll(/^(\S[^{\n]*) \{\n([^}]*)\}/gm)].map(([, selector, body]) => [
        selector,
        body,
      ]),
    )
    const declared = (selector: string) =>
      Object.fromEntries(
        [...(blocks.get(selector) ?? "").matchAll(/(--bpmn-[\w-]+): ([^;]+);/g)].map(
          ([, name, value]) => [name, value],
        ),
      )
    expect(declared(`[data-slot="${BPMN_CANVAS_SLOT}"]`)).toEqual(BPMN_CANVAS_ROLES.light)
    expect(declared(BPMN_DARK_CANVAS)).toEqual(BPMN_CANVAS_ROLES.dark)
    expect(blocks.get(`[data-slot="${BPMN_CANVAS_SLOT}"]`)).toContain(
      `background-color: ${V("paper")};`,
    )
  })

  // happy-dom cannot match this selector; test:host proves it in Chromium (a light island in a dark
  // host keeps a light canvas, `host-sim.spec.ts`).
  it("is dark exactly where pulse-ui's `dark:` variant is: the same selector on the canvas", () => {
    const variant = /@custom-variant dark \((.+)\);/.exec(THEME_CSS)?.[1]
    expect(variant).toBeDefined()
    expect(BPMN_DARK_CANVAS).toBe(variant?.replaceAll("&", `[data-slot="${BPMN_CANVAS_SLOT}"]`))
  })
})

const CANVAS = `[data-slot="${BPMN_CANVAS_SLOT}"]`
const outlineOf = (marker: string) => `.djs-shape.${marker} > .djs-visual > :first-child:not(text)`
const V_NAME = (key: string) => BPMN_CANVAS_VARS[key as keyof typeof BPMN_CANVAS_VARS]

describe("high contrast, as the webview's canvas (data-cd-kontrast, D10 point 7)", () => {
  it("widens a running and an incident outline to 3 px; an open task keeps its 3 px dash", () => {
    for (const marker of ["highlight-running", "highlight-incident"]) {
      const rule = declarations(`${BPMN_HIGH_CONTRAST} ${outlineOf(marker)}`, null)
      expect(rule.get("stroke-width"), marker).toBe("3px !important")
    }
    const open = declarations(outlineOf("highlight-open-user-task"), null)
    expect(open.get("stroke-width")).toBe("3px !important")
    expect(open.get("stroke-dasharray")).toBe("8 4 !important")
  })

  it("edges a count badge in the ink instead of its ring of paper, at 3:1 on it in both modes", () => {
    const badge = declarations(`${BPMN_HIGH_CONTRAST} .bpmn-overlay-badge`, null)
    expect(badge.get("box-shadow")).toBe("none")
    expect(badge.get("outline")).toBe(`1px solid ${V("ink")}`)
    // The edge parts the badge from the paper whatever the badge's own fill.
    for (const mode of ["light", "dark"] as const)
      expect(ratio(V("ink"), V("paper"), mode)).toBeGreaterThanOrEqual(3)
  })
})

describe("forced colours: the drawing in the system's palette, as the webview's markers and badges", () => {
  it("the canvas declares the paper, the ink and every marker in system colours over every mode", () => {
    const canvas = declarations(CANVAS, FORCED)
    expect(canvas.get("forced-color-adjust")).toBe("none")
    expect(canvas.get("border-color")).toBe("CanvasText")
    const system: Partial<Record<keyof typeof BPMN_CANVAS_VARS, string>> = {
      paper: "Canvas",
      ink: "CanvasText",
      badgeShadow: "none",
    }
    for (const tone of ["incident", "running", "openTask"] as const) {
      system[`${tone}Stroke` as const] = "Highlight"
      system[`${tone}Fill` as const] = "Canvas"
    }
    // Every variable but the heat's, which keeps its ramp.
    expect(BPMN_FORCED_CANVAS).toEqual(
      Object.fromEntries(Object.entries(system).map(([key, value]) => [V_NAME(key), value])),
    )
    // Important, so a dark scope's normal declarations never win over the system's palette.
    for (const [name, value] of Object.entries(BPMN_FORCED_CANVAS))
      expect(canvas.get(name), name).toBe(`${value} !important`)
  })

  it("a count badge is Canvas with CanvasText, edged in CanvasText; bpmn.io's link LinkText", () => {
    const badge = declarations(`${CANVAS} .bpmn-overlay-badge`, FORCED)
    expect(Object.fromEntries(badge)).toEqual({
      border: "1px solid CanvasText",
      background: "Canvas",
      color: "CanvasText",
    })
    expect(declarations(`${CANVAS} .bjs-powered-by`, FORCED).get("color")).toBe(
      "LinkText !important",
    )
    // Above a mode's own rule for the link: the dark one counts no more than one class.
    expect(BPMN_OVERLAY_CSS).toContain(`:where(${BPMN_DARK_CANVAS}) .bjs-powered-by {`)
  })

  it("an incident and a running outline, both Highlight, differ by their width, in high contrast too", () => {
    expect(declarations(outlineOf("highlight-incident"), FORCED).get("stroke-width")).toBe(
      "3px !important",
    )
    expect(declarations(outlineOf("highlight-running"), FORCED).size).toBe(0)
    expect(
      declarations(`${BPMN_HIGH_CONTRAST} ${outlineOf("highlight-running")}`, FORCED).get(
        "stroke-width",
      ),
    ).toBe("2px !important")
    expect(declarations(outlineOf("highlight-running"), null).get("stroke-width")).toBe(
      "2px !important",
    )
  })

  it("the heat keeps its ramp, multiplied into a light palette and screened into a dark one", () => {
    const heat = (media: string) =>
      Object.fromEntries(
        [...declarations(CANVAS, media)].filter(([name]) => name.startsWith("--bpmn-heat-")),
      )
    const important = (mode: Mode) =>
      Object.fromEntries(
        Object.entries(BPMN_CANVAS_ROLES[mode])
          .filter(([name]) => name.startsWith("--bpmn-heat-"))
          .map(([name, value]) => [name, `${value} !important`]),
      )
    expect(heat(FORCED)).toEqual(important("light"))
    expect(heat(FORCED_DARK)).toEqual(important("dark"))
  })
})

/**
 * The graphics bpmn-js draws, reduced to their classes: the process's layer (an activity instance
 * tree's root names the process, so the instance view marks it too), an event with its external
 * label beside it, a task with its name inside, an expanded subprocess with a task inside.
 */
const DRAWN = `
<svg xmlns="http://www.w3.org/2000/svg"><g class="layer-root highlight-running highlight-incident highlight-open-user-task">
  <g class="djs-group"><g class="djs-element djs-shape" data-element-id="start"><g class="djs-visual"><circle data-part="start"/></g></g></g>
  <g class="djs-group"><g class="djs-element djs-shape" data-element-id="start_label"><g class="djs-visual"><text data-part="start label"/></g></g></g>
  <g class="djs-group"><g class="djs-element djs-shape MARKER" data-element-id="task"><g class="djs-visual"><rect data-part="task"/><text data-part="task name"/></g></g></g>
  <g class="djs-group"><g class="djs-element djs-shape MARKER" data-element-id="sub"><g class="djs-visual"><rect data-part="sub"/></g></g>
    <g class="djs-children"><g class="djs-group"><g class="djs-element djs-shape" data-element-id="inner"><g class="djs-visual"><rect data-part="inner"/></g></g></g></g>
  </g>
  <g class="djs-group"><g class="djs-element djs-connection MARKER" data-element-id="flow"><g class="djs-visual"><path data-part="flow"/></g></g></g>
</g></svg>`

describe("a marker paints its shape's outline, never a label or what lies inside", () => {
  it.each(["highlight-running", "highlight-open-user-task", "highlight-incident"])(
    "%s: the marked task's and subprocess's own outline, nothing of the process's layer, in every mode",
    (marker) => {
      // High contrast on the document, so its rules' selectors reach the drawing too.
      document.documentElement.dataset.cdKontrast = "hoch"
      document.body.innerHTML = DRAWN.replaceAll("MARKER", marker)
      const selectors = RULES.flatMap((rule) => rule.selectors).filter((selector) =>
        selector.includes(`.${marker} `),
      )
      expect(selectors.length).toBeGreaterThanOrEqual(1)
      for (const selector of selectors) {
        const painted = [...document.querySelectorAll(selector)].map((el) =>
          el.getAttribute("data-part"),
        )
        // Not the event or its label (only the process's layer carries the marker), not the
        // task's name, not the task inside the subprocess, not the flow.
        expect(painted, selector).toEqual(["task", "sub"])
      }
      delete document.documentElement.dataset.cdKontrast
    },
  )
})

describe.each(["light", "dark"] as const)(
  "BPMN canvas contrast, %s (CI §3.6: strokes ≥ 3:1, text ≥ 4.5:1)",
  (mode) => {
    it("the ink reads on the paper as text: every label, flow and shape bpmn-js draws", () => {
      expect(ratio(V("ink"), V("paper"), mode)).toBeGreaterThanOrEqual(4.5)
    })

    it.each([
      ["incident", "incidentStroke", "incidentFill"],
      ["running", "runningStroke", "runningFill"],
      ["open task", "openTaskStroke", "openTaskFill"],
    ] as const)(
      "%s: the stroke reads against the paper and its own fill, the task's name on that fill",
      (_, stroke, fill) => {
        expect(ratio(V(stroke), V("paper"), mode)).toBeGreaterThanOrEqual(3)
        expect(ratio(V(stroke), V(fill), mode)).toBeGreaterThanOrEqual(3)
        expect(ratio(V("ink"), V(fill), mode)).toBeGreaterThanOrEqual(4.5)
      },
    )

    it.each([
      ["instance count", BPMN_TOKENS.instanceBadge],
      ["incident count", BPMN_TOKENS.incidentBadge],
    ] as const)("%s: its text reads on its fill, the badge stands off the paper", (_, badge) => {
      expect(ratio(cdVar(badge.text), cdVar(badge.fill), mode)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(cdVar(badge.fill), V("paper"), mode)).toBeGreaterThanOrEqual(3)
    })

    it("bpmn.io's link stays legible on the paper (a licence term)", () => {
      const credit =
        mode === "dark"
          ? (/\.bjs-powered-by \{\s*color: (var\([\w-]+\)) !important;/.exec(
              BPMN_OVERLAY_CSS,
            )?.[1] ?? "")
          : LINK_STYLES.color
      expect(ratio(credit, V("paper"), mode)).toBeGreaterThanOrEqual(4.5)
    })
  },
)
