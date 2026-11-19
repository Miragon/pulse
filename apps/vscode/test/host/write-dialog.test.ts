import type { WriteRequest } from "@miragon/pulse-runtime-view/core"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { WriteDialog } from "../../src/host/panels/write-dialog.js"

const shown = vi.hoisted(() => ({
  details: [] as string[],
  answer: undefined as string | undefined,
  typed: undefined as string | undefined,
  hints: [] as (string | undefined)[],
}))

vi.mock("vscode", () => ({
  window: {
    showWarningMessage: (_title: string, options: { detail: string }) => {
      shown.details.push(options.detail)
      return Promise.resolve(shown.answer)
    },
    showInputBox: (options: { validateInput: (value: string) => string | undefined }) => {
      shown.hints.push(options.validateInput("localhost"), options.validateInput("localhost:18090"))
      return Promise.resolve(shown.typed)
    },
  },
}))

const NO_LOGIN = "No login: the engine records neither who nor why."
const ENGINE = { name: "shop-dev", environment: "local", host: "localhost:18090" }

function request(action: WriteRequest["action"]): WriteRequest {
  return { action, title: "Move?", facts: ["Reason: hotfix"], confirmLabel: "Move" }
}

describe("the write dialog", () => {
  beforeEach(() => {
    shown.details = []
    shown.answer = undefined
    shown.typed = undefined
    shown.hints = []
  })

  test("goes ahead without asking where the policy asks for no confirmation", async () => {
    expect(await new WriteDialog(request("retryIncident"), ENGINE).confirm("none")).toBe(true)
    expect(shown.details).toEqual([])
  })

  test("asks for the host of an engine off this machine after the dialog, and goes ahead only when it is typed", async () => {
    const dialog = new WriteDialog(request("moveToken"), ENGINE)
    shown.answer = "Move"

    shown.typed = "localhost:18090"
    expect(await dialog.confirm("typeHost")).toBe(true)
    shown.typed = "localhost"
    expect(await dialog.confirm("typeHost")).toBe(false)
    expect(shown.hints.slice(0, 2)).toEqual(["Type localhost:18090", undefined])
  })

  test("asks for no host once the dialog is dismissed", async () => {
    expect(await new WriteDialog(request("moveToken"), ENGINE).confirm("typeHost")).toBe(false)
    expect(shown.hints).toEqual([])
  })

  test("says that the engine does not record who migrated when it has no login", async () => {
    await new WriteDialog(
      { action: "migrateInstances", title: "Migrate?", facts: [], confirmLabel: "Migrate" },
      ENGINE,
    ).confirm("modal")
    await new WriteDialog(
      { action: "migrateInstances", title: "Migrate?", facts: [], confirmLabel: "Migrate" },
      { ...ENGINE, identity: "demo" },
    ).confirm("modal")

    expect(shown.details.map((detail) => detail.includes("doesn't record who migrated"))).toEqual([
      true,
      false,
    ])
  })

  test.each([
    ["a move on an engine without login", "moveToken", undefined, true],
    ["a move as a signed-in user", "moveToken", "demo", false],
    ["a retry on an engine without login", "retryIncident", undefined, false],
  ] as const)(
    "%s says whether the engine keeps the reason",
    async (_case, action, identity, says) => {
      const engine = identity === undefined ? ENGINE : { ...ENGINE, identity }

      await new WriteDialog(request(action), engine).confirm("modal")

      expect(shown.details[0]?.includes(NO_LOGIN)).toBe(says)
    },
  )
})
