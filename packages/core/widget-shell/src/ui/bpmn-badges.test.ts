import { describe, expect, it } from "vitest"
import { BPMN_CANVAS_VARS, BPMN_OVERLAY_CSS } from "./bpmn-tokens.js"

const V = (name: keyof typeof BPMN_CANVAS_VARS) => `var(${BPMN_CANVAS_VARS[name]})`

/** The declarations of the canvas's top-level rule for exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const body = new RegExp(`(?:^|\\n)${selector.replace(/[.-]/g, "\\$&")} \\{([^}]*)\\}`).exec(
    BPMN_OVERLAY_CSS,
  )?.[1]
  return Object.fromEntries(
    [...(body ?? "").matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  )
}

/**
 * Owner decision D2, amended on 2026-11-19: the incidents of the instances an element called are
 * never part of its incident count, so their badge is quiet (on the paper, in the ink, the
 * incident's colour in its edge alone), never filled in the incident's red as a root incident's.
 * Its high-contrast edge and its forced colours are every count badge's (bpmn-tokens.test.ts).
 */
describe("the incidents in called instances on the canvas", () => {
  it("are a quiet badge: the paper, the ink, the incident's colour in its edge", () => {
    expect(rule(".bpmn-overlay-badge--called-incident-count")).toEqual({
      border: `1.5px solid ${V("incidentStroke")}`,
      background: V("paper"),
      color: V("ink"),
    })
  })

  it("never take the root incidents' fill", () => {
    const filled = rule(".bpmn-overlay-badge--incident-count")
    expect(filled.background).toBeDefined()
    expect(rule(".bpmn-overlay-badge--called-incident-count").background).not.toBe(
      filled.background,
    )
  })
})
