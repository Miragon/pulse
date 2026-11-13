import { mount, type MockHost, type TestPanel } from "orca/testing"
import { afterEach, describe, expect, test } from "vitest"
import * as panel from "../../../src/panel/engines.js"
import type { Prompt } from "../../../src/protocol.js"
import { panelHost, sent } from "./panel-host.js"

const CONFIRM: Prompt = {
  id: "p-confirm",
  kind: "confirm",
  title: "Retry the job of order-4711?",
  facts: ["Engine: shop-dev", "Job: 0815"],
  confirmLabel: "Retry",
}

const BULK: Prompt = {
  id: "p-bulk",
  kind: "bulk",
  title: "Cancel 12 instances on shop-test?",
  facts: ["Definition: order"],
  confirmLabel: "Cancel instances",
  countPrompt: "Type the number of instances",
  count: 12,
  warning: "This cannot be undone.",
  typeHost: "shop-test",
  reason: { prompt: "Why are they cancelled?", required: true },
}

const PICK: Prompt = {
  id: "p-pick",
  kind: "pick",
  title: "Which version?",
  choices: [
    { key: "order:3", label: "Version 3", description: "Deployed today" },
    { key: "order:2", label: "Version 2", description: "Deployed last week" },
  ],
}

const CANCEL = { role: "button", text: "Cancel" }
let view: TestPanel | undefined

function promptHost(prompts: readonly Prompt[]): MockHost {
  let waiting = prompts
  return panelHost({
    "prompts.list": () => ({ prompts: waiting }),
    "prompts.answer": ({ id }) => {
      waiting = waiting.filter((prompt) => prompt.id !== id)
      return { ok: true }
    },
  })
}

async function mounted(host: MockHost): Promise<TestPanel> {
  view = await mount(panel, { host })
  return view
}

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

describe("a confirmation", () => {
  test("shows its facts and confirms with one press", async () => {
    const host = promptHost([CONFIRM])
    const shown = await mounted(host)

    expect(shown.summary()).toContain(`Callout warning "${CONFIRM.title}"`)
    expect(shown.find({ text: "Job: 0815" })).not.toBeNull()
    await shown.press({ role: "button", text: "Retry" })

    expect(sent(host, "prompts.answer")).toEqual([
      { id: "p-confirm", answer: { kind: "confirm", confirmed: true, typedHost: "" } },
    ])
    expect(shown.summary()).not.toContain(`Callout warning "${CONFIRM.title}"`)
    expect(shown.errors).toEqual([])
    expect(shown.refusals).toEqual([])
  })

  test("waits for the typed host before it confirms", async () => {
    const host = promptHost([{ ...CONFIRM, typeHost: "shop-dev" }])
    const shown = await mounted(host)
    const retry = { role: "button", text: "Retry" }

    expect(shown.find(retry)?.disabled).toBe(true)
    await shown.type({ label: "Type shop-dev to confirm" }, "shop-de")
    expect(shown.find(retry)?.disabled).toBe(true)
    await shown.type({ label: "Type shop-dev to confirm" }, "v")
    await shown.press(retry)

    expect(sent(host, "prompts.answer")).toEqual([
      { id: "p-confirm", answer: { kind: "confirm", confirmed: true, typedHost: "shop-dev" } },
    ])
  })

  test("is cancelled with the cancel button", async () => {
    const host = promptHost([CONFIRM])
    const shown = await mounted(host)

    await shown.press(CANCEL)

    expect(sent(host, "prompts.answer")).toEqual([
      { id: "p-confirm", answer: { kind: "confirm", confirmed: false } },
    ])
  })
})

describe("a bulk confirmation", () => {
  const confirm = { role: "button", text: "Cancel instances" }

  async function typeAll(shown: TestPanel, reason: string): Promise<void> {
    await shown.type({ label: "Type the number of instances" }, "12")
    await shown.type({ label: "Type shop-test to confirm" }, "shop-test")
    if (reason !== "") {
      await shown.type({ label: /^Reason/ }, reason)
    }
  }

  test("needs the count, the host and the required reason", async () => {
    const host = promptHost([BULK])
    const shown = await mounted(host)
    expect(shown.find({ text: "This cannot be undone." })).not.toBeNull()
    expect(shown.find({ label: "Reason (required on this engine)" })).not.toBeNull()

    await typeAll(shown, "")
    expect(shown.find(confirm)?.disabled).toBe(true)
    await shown.type({ label: /^Reason/ }, "Duplicates")
    await shown.press(confirm)

    expect(sent(host, "prompts.answer")).toEqual([
      {
        id: "p-bulk",
        answer: {
          kind: "bulk",
          confirmed: true,
          typedCount: "12",
          typedHost: "shop-test",
          reason: "Duplicates",
        },
      },
    ])
  })

  test("refuses a wrong count", async () => {
    const shown = await mounted(promptHost([BULK]))

    await typeAll(shown, "Duplicates")
    await shown.type({ label: "Type the number of instances" }, "13", { replace: true })

    expect(shown.find(confirm)?.disabled).toBe(true)
  })

  test("confirms without a reason where it is optional", async () => {
    const optional: Prompt = { ...BULK, reason: { prompt: "Why?", required: false } }
    const host = promptHost([optional])
    const shown = await mounted(host)
    expect(shown.find({ label: "Reason (optional)" })).not.toBeNull()

    await typeAll(shown, "")
    await shown.press(confirm)

    expect(sent(host, "prompts.answer")).toEqual([
      {
        id: "p-bulk",
        answer: {
          kind: "bulk",
          confirmed: true,
          typedCount: "12",
          typedHost: "shop-test",
          reason: "",
        },
      },
    ])
  })

  test("is cancelled with the cancel button", async () => {
    const host = promptHost([BULK])
    const shown = await mounted(host)

    await shown.press(CANCEL)

    expect(sent(host, "prompts.answer")).toEqual([
      { id: "p-bulk", answer: { kind: "bulk", confirmed: false } },
    ])
  })
})

describe("a pick list", () => {
  test("answers with the pressed choice", async () => {
    const host = promptHost([PICK])
    const shown = await mounted(host)

    await shown.press({ label: "Version 2" })

    expect(sent(host, "prompts.answer")).toEqual([
      { id: "p-pick", answer: { kind: "pick", key: "order:2" } },
    ])
    expect(shown.find({ label: "Version 2" })).toBeNull()
  })

  test("answers with no key when cancelled", async () => {
    const host = promptHost([PICK])
    const shown = await mounted(host)

    await shown.press(CANCEL)

    expect(sent(host, "prompts.answer")).toEqual([{ id: "p-pick", answer: { kind: "pick" } }])
  })
})

describe("the worker's posts", () => {
  test("reload the prompts when they changed", async () => {
    let waiting: readonly Prompt[] = []
    const host = panelHost({ "prompts.list": () => ({ prompts: waiting }) })
    const shown = await mounted(host)
    waiting = [CONFIRM]

    await shown.post("prompts.changed", { count: 1 })

    expect(sent(host, "prompts.list")).toHaveLength(2)
    expect(shown.summary()).toContain(`Callout warning "${CONFIRM.title}"`)
  })

  test("show a notice as a callout of its tone", async () => {
    const shown = await mounted(panelHost())

    await shown.post("notices.show", { notice: { tone: "success", text: "Retried 1 job." } })

    expect(shown.summary()).toContain('Callout success "Retried 1 job."')
    expect(shown.warnings).toEqual([])
  })
})
