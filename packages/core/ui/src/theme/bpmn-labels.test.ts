import { describe, expect, it } from "vitest"
import { BPMN_LABEL_STYLE } from "./bpmn-labels.js"

describe("the labels on a BPMN canvas", () => {
  it("are bpmn-js's own Arial at its sizes, the ones the modelers size label boxes for", () => {
    expect(BPMN_LABEL_STYLE).toEqual({
      defaultStyle: {
        fontFamily: "Arial, sans-serif",
        fontSize: 12,
        fontWeight: "normal",
        lineHeight: 1.2,
      },
      externalStyle: { fontSize: 11, lineHeight: 1.2 },
    })
  })

  it("name no Geist: the external labels take the family of the labels inside a shape", () => {
    expect(JSON.stringify(BPMN_LABEL_STYLE)).not.toMatch(/geist/i)
    expect(BPMN_LABEL_STYLE.externalStyle).not.toHaveProperty("fontFamily")
  })
})
