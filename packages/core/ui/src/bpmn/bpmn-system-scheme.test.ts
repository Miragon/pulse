import { describe, expect, it } from "vitest"
import {
  BPMN_CANVAS_ROLES,
  BPMN_CANVAS_SLOT,
  BPMN_OVERLAY_CSS,
  BPMN_SYSTEM_DARK_CANVAS,
} from "./bpmn-tokens.js"

/**
 * A page without a script names no mode on its root: the kit follows the system's scheme there,
 * and so does the canvas, never inside a light island. A host and the web app name the mode
 * (widget-shell's `applyDocumentTheme`), so the rule never reaches them.
 */
describe("the canvas where the page names no mode", () => {
  const block = /@media \(prefers-color-scheme: dark\) \{\n {2}(\S[^{\n]*) \{\n([^}]*)\}/.exec(
    BPMN_OVERLAY_CSS,
  )

  it("is dark under the system's dark scheme: the dark canvas's variables", () => {
    expect(block?.[1]).toBe(BPMN_SYSTEM_DARK_CANVAS)
    expect(
      Object.fromEntries(
        [...(block?.[2] ?? "").matchAll(/(--bpmn-[\w-]+): ([^;]+);/g)].map(([, name, value]) => [
          name,
          value,
        ]),
      ),
    ).toEqual(BPMN_CANVAS_ROLES.dark)
    expect(BPMN_OVERLAY_CSS).toContain(`:where(${BPMN_SYSTEM_DARK_CANVAS}) .bjs-powered-by {`)
  })

  it("applies only where the root names neither mode attribute, never inside a light island", () => {
    expect(BPMN_SYSTEM_DARK_CANVAS).toBe(
      `:root:not([data-theme], [data-cd-theme]) [data-slot="${BPMN_CANVAS_SLOT}"]:not(:is([data-theme-mode="light"], [data-cd-theme="light"]) *)`,
    )
  })
})
