import type { BulkRequest } from "../../src/core/index.js"
import { beforeEach, describe, expect, test, vi } from "vitest"

interface InputOptions {
  readonly title: string
  readonly validateInput: (value: string) => string | undefined
}

const window = vi.hoisted(() => ({
  showWarningMessage: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(),
  showInputBox: vi.fn<(options: InputOptions) => Promise<string | undefined>>(),
}))

vi.mock("vscode", () => ({ window }))

const { BulkDialog } = await import("../../src/host/panels/bulk-dialog.js")

const REQUEST: BulkRequest = {
  action: "cancelInstances",
  title: "Cancel 44 instances of Order v3?",
  facts: ["Filter: Running", "47 selected · 3 already ended, left alone"],
  confirmLabel: "Cancel 44 instances",
  selected: 47,
  count: 44,
  countPrompt: "Type 44 to cancel 44 instances",
  warning: "Cancelling can't be undone.",
  takesReason: true,
  reasonPrompt: "The engine keeps it with the cancelled instances. Pulse does not log it.",
}

const ENGINE = { name: "shop-prod", environment: "PRODUCTION", host: "shop.example.com" }

function answering(...inputs: (string | undefined)[]): InputOptions[] {
  const asked: InputOptions[] = []
  window.showWarningMessage.mockResolvedValue(REQUEST.confirmLabel)
  for (const input of inputs) {
    window.showInputBox.mockImplementationOnce((options) => {
      asked.push(options)
      return Promise.resolve(input)
    })
  }
  return asked
}

beforeEach(() => {
  window.showWarningMessage.mockReset()
  window.showInputBox.mockReset()
})

describe("confirming a bulk write", () => {
  test("asks for the count on this machine, and neither host nor reason", async () => {
    const asked = answering("44")

    expect(await new BulkDialog(REQUEST, ENGINE).confirm("none")).toEqual({})
    expect(asked.map((options) => options.title)).toEqual(["Type 44 to cancel 44 instances"])
    expect(asked[0]!.validateInput("1,044")).toBe("Type 44")
    expect(asked[0]!.validateInput("")).toBeUndefined()
  })

  test("asks for an optional reason on a test engine and keeps it printable", async () => {
    const asked = answering("44", "  cleanup‮ after test  ")

    expect(await new BulkDialog(REQUEST, ENGINE).confirm("modal")).toEqual({
      reason: "cleanup  after test",
    })
    expect(asked[1]!.title).toBe("Reason (optional)")
    expect(asked[1]!.validateInput("")).toBeUndefined()
  })

  test("sends no reason when the optional one is left empty", async () => {
    answering("44", "   ")

    expect(await new BulkDialog(REQUEST, ENGINE).confirm("modal")).toEqual({})
  })

  test("asks for the count, then the host, then a required reason on production", async () => {
    const asked = answering("44", "shop.example.com", "ticket 4711")

    expect(await new BulkDialog(REQUEST, ENGINE).confirm("typeHost")).toEqual({
      reason: "ticket 4711",
    })
    expect(asked.map((options) => options.title)).toEqual([
      "Type 44 to cancel 44 instances",
      "Type shop.example.com to confirm",
      "Reason (required on this engine)",
    ])
    expect(asked[2]!.validateInput("  ")).toBe("Give a reason to go ahead")
    expect(asked[2]!.validateInput("\u200b\u2060")).toBe("Give a reason to go ahead")
    expect(asked[2]!.validateInput("x".repeat(501))).toBe("At most 500 characters")
  })

  test("writes nothing when any step is dismissed", async () => {
    window.showWarningMessage.mockResolvedValue(undefined)
    expect(await new BulkDialog(REQUEST, ENGINE).confirm("none")).toBeUndefined()

    answering(undefined)
    expect(await new BulkDialog(REQUEST, ENGINE).confirm("none")).toBeUndefined()

    answering("44", "shop.example.com", undefined)
    expect(await new BulkDialog(REQUEST, ENGINE).confirm("typeHost")).toBeUndefined()
  })

  test("asks for no reason when the operation sends none to the engine", async () => {
    const asked = answering("44", "shop.example.com")

    expect(
      await new BulkDialog({ ...REQUEST, takesReason: false }, ENGINE).confirm("typeHost"),
    ).toEqual({})
    expect(asked).toHaveLength(2)
  })
})
