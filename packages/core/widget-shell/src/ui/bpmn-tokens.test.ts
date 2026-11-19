// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { CD_TOKENS, type CdTokenName } from "@miragon/pulse-ui"
import {
  contrastRatio,
  parseThemeVariables,
  resolveColor,
  themeStylesheets,
} from "@miragon/pulse-ui/testing"
import { BPMN_OVERLAY_CSS, BPMN_TOKENS, cdVar } from "./bpmn-tokens.js"

/** Every `--cd-*` token name the module uses. */
function tokenNames(value: unknown): CdTokenName[] {
  if (typeof value === "string") return [value as CdTokenName]
  return Object.values(value as Record<string, unknown>).flatMap(tokenNames)
}

const USED = [...new Set(tokenNames(BPMN_TOKENS))]

/** The vendored corporate-design stylesheet, as pulse-ui ships it (the tokens come first). */
function vendoredTokens(): Map<string, string> {
  const [css] = themeStylesheets()
  return new Map(
    [...css.matchAll(/--cd-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  )
}

/** A token on the light paper (the canvas is light in every theme). */
const light = parseThemeVariables(...themeStylesheets()).light
const color = (name: CdTokenName) => resolveColor(cdVar(name), light)
const ratio = (a: CdTokenName, b: CdTokenName) => contrastRatio(color(a), color(b))

describe("BPMN token module ↔ the vendored CSS (modeler-tool-design §13 drift test)", () => {
  it("names only tokens the vendored stylesheet defines, with the same value as CD_TOKENS", () => {
    const css = vendoredTokens()
    expect(USED.length).toBeGreaterThan(0)
    for (const name of USED) {
      expect(css.get(name), `--cd-${name}`).toBeDefined()
      expect(CD_TOKENS[name].toLowerCase(), `--cd-${name}`).toBe(css.get(name)?.toLowerCase())
    }
  })

  it("the overlay CSS refers to the tokens by variable: no raw colour", () => {
    expect(BPMN_OVERLAY_CSS).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    const referenced = [...BPMN_OVERLAY_CSS.matchAll(/var\(--cd-([\w-]+)\)/g)].map((m) => m[1])
    const css = vendoredTokens()
    for (const name of referenced) expect(css.has(name), `--cd-${name}`).toBe(true)
    for (const marker of [BPMN_TOKENS.incident, BPMN_TOKENS.running, BPMN_TOKENS.openTask]) {
      expect(BPMN_OVERLAY_CSS).toContain(`stroke: ${cdVar(marker.stroke)} !important`)
      expect(BPMN_OVERLAY_CSS).toContain(`fill: ${cdVar(marker.fill)} !important`)
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
  })

  it("an open task stands still: a dashed stroke, no animation (prefers-reduced-motion)", () => {
    expect(BPMN_OVERLAY_CSS).not.toMatch(/animation|@keyframes|transition/)
    expect(BPMN_OVERLAY_CSS).toMatch(/highlight-open-user-task[^}]*stroke-dasharray/)
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
  const rules = [...BPMN_OVERLAY_CSS.matchAll(/^([^{}\n]*highlight-[^{}\n]*)\{/gm)].map((m) =>
    m[1].trim(),
  )

  it.each(["highlight-running", "highlight-open-user-task", "highlight-incident"])(
    "%s: the marked task's and subprocess's own outline, nothing of the process's layer",
    (marker) => {
      document.body.innerHTML = DRAWN.replaceAll("MARKER", marker)
      const selectors = rules.filter((rule) => rule.includes(`.${marker} `))
      expect(selectors).toHaveLength(1)
      const painted = [...document.querySelectorAll(selectors[0])].map((el) =>
        el.getAttribute("data-part"),
      )
      // Not the event or its label (only the process's layer carries the marker), not the
      // task's name, not the task inside the subprocess, not the flow.
      expect(painted).toEqual(["task", "sub"])
    },
  )
})

describe("BPMN palette contrast (CI §3.6: strokes ≥ 3:1, text ≥ 4.5:1)", () => {
  it.each([
    ["incident", BPMN_TOKENS.incident],
    ["running", BPMN_TOKENS.running],
    ["open task", BPMN_TOKENS.openTask],
  ] as const)("%s: the stroke reads against the paper and against its own tint", (_, marker) => {
    expect(ratio(marker.stroke, BPMN_TOKENS.paper)).toBeGreaterThanOrEqual(3)
    expect(ratio(marker.stroke, marker.fill)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ["instance count", BPMN_TOKENS.instanceBadge],
    ["incident count", BPMN_TOKENS.incidentBadge],
  ] as const)("%s: the badge text reaches 4.5:1 on its fill", (_, badge) => {
    expect(ratio(badge.text, badge.fill)).toBeGreaterThanOrEqual(4.5)
  })

  it("a badge stands off the paper (3:1)", () => {
    for (const badge of [BPMN_TOKENS.instanceBadge, BPMN_TOKENS.incidentBadge]) {
      expect(ratio(badge.fill, BPMN_TOKENS.paper)).toBeGreaterThanOrEqual(3)
    }
  })
})
