import { describe, expect, test } from "vitest"
import { RENDERER_COLORS } from "../../src/webview/diagram/canvas-roles.js"
import { hell } from "../../src/webview/theme/cd-tokens.generated.json"

describe("the colours the diagram renderer draws with", () => {
  test("are the light plot and text roles of the vendored tokens", () => {
    expect(RENDERER_COLORS).toEqual({
      defaultFillColor: hell["--cd-ui-plot"],
      defaultStrokeColor: hell["--cd-ui-text"],
      defaultLabelColor: hell["--cd-ui-text"],
    })
  })
})
