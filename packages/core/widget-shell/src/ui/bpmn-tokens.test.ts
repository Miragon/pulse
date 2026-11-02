import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { CD_TOKENS, type CdTokenName } from "@miragon/pulse-ui"
import {
  contrastRatio,
  parseThemeVariables,
  resolveColor,
  themeStylesheets,
} from "@miragon/pulse-ui/testing"
import { BPMN_OVERLAY_CSS, BPMN_TOKENS, cdValue, cdVar } from "./bpmn-tokens.js"

/** Every `--cd-*` token name the module uses. */
function tokenNames(value: unknown): CdTokenName[] {
  if (typeof value === "string") return [value as CdTokenName]
  return Object.values(value as Record<string, unknown>).flatMap(tokenNames)
}

const USED = [...new Set(tokenNames(BPMN_TOKENS))]

/** The vendored corporate-design stylesheet, as pulse-ui ships it. */
function vendoredTokens(): Map<string, string> {
  const require = createRequire(import.meta.url)
  const css = readFileSync(require.resolve("@miragon/pulse-ui/cd-tokens.generated.css"), "utf8")
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
      expect(cdValue(name).toLowerCase(), `--cd-${name}`).toBe(css.get(name)?.toLowerCase())
      expect(CD_TOKENS[name]).toBe(cdValue(name))
    }
  })

  it("the overlay CSS refers to the tokens by variable — no raw colour", () => {
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
