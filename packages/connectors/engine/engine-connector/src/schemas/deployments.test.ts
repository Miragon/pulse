import { describe, expect, it } from "vitest"
import { createDeploymentInput } from "./index.js"

const BPMN = '<definitions id="d"><process id="order"/></definitions>'

describe("createDeploymentInput", () => {
  it("accepts a named deployment with distinct resources and the optional flags", () => {
    const input = {
      deploymentName: "orders",
      enableDuplicateFiltering: true,
      deployChangedOnly: false,
      deploymentSource: "pulse",
      tenantId: "tenant-a",
      resources: [
        { name: "order.bpmn", content: BPMN },
        { name: "rules.dmn", content: "<definitions/>" },
      ],
    }
    expect(createDeploymentInput.parse(input)).toEqual(input)
  })

  it("requires at least one resource", () => {
    expect(createDeploymentInput.safeParse({ deploymentName: "d", resources: [] }).success).toBe(
      false,
    )
  })

  it("rejects a resource without a file name — the engine names the resource after it", () => {
    const result = createDeploymentInput.safeParse({
      deploymentName: "d",
      resources: [{ name: "", content: BPMN }],
    })
    expect(result.success).toBe(false)
  })

  // Each name below is one the transport or the engine's multipart parser
  // would REWRITE, so it would be deployed under another name — and could
  // collide with a distinct name the uniqueness check let through.
  it.each([
    ['a"b.bpmn', 'Resource names must not contain " or \\'],
    ["a\\b.bpmn", 'Resource names must not contain " or \\'],
    ["a\r\nb.bpmn", "Resource names must not contain control characters"],
    ["tab\t.bpmn", "Resource names must not contain control characters"],
    ["a\u0000b.bpmn", "Resource names must not contain control characters"],
    [" order.bpmn", "Resource names must not start or end with whitespace"],
    ["order.bpmn ", "Resource names must not start or end with whitespace"],
    [" ", "Resource names must not start or end with whitespace"],
    ["=?utf-8?q?order?=.bpmn", 'Resource names must not contain "=?"'],
  ])("rejects %j, a name that would not reach the engine unchanged", (name, message) => {
    const result = createDeploymentInput.safeParse({
      deploymentName: "d",
      resources: [{ name, content: BPMN }],
    })
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["resources", 0, "name"], message }),
    ])
  })

  it("accepts names that travel unchanged — paths, inner spaces, percent signs, non-ASCII", () => {
    const names = ["processes/order process.bpmn", "Größe – Rabattstufen.dmn", "100%.form"]
    const result = createDeploymentInput.safeParse({
      deploymentName: "d",
      resources: names.map((name) => ({ name, content: BPMN })),
    })
    expect(result.error).toBeUndefined()
  })

  it("rejects repeated resource names instead of letting the engine drop one silently", () => {
    const result = createDeploymentInput.safeParse({
      deploymentName: "d",
      resources: [
        { name: "order.bpmn", content: BPMN },
        { name: "order.bpmn", content: BPMN },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["resources"],
        message: "Resource names must be unique within one deployment",
      }),
    ])
  })
})
