import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { WRITABLE_INCIDENT_ID, WRITABLE_INSTANCE } from "../../dev/webview/fixtures/writable.js"
import { JsonText } from "../../src/webview/format/json-text.js"
import {
  buttonNamed,
  colourOfVariable,
  enterValue,
  type Harness,
  mountApp,
  findPart,
  findRole,
  getRole,
  nextFrame,
  part,
  queryPart,
  queryRole,
} from "./harness.js"

const VARIABLES_TAB = "Variables8"

describe("writing from the instance screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  async function openVariables() {
    harness = mountApp()
    harness.publish(FIXTURES["instance-writable"])
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, VARIABLES_TAB).click()
    await findRole(harness.root, "button", { name: "Edit amount" })
  }

  function editButton(name: string): HTMLButtonElement {
    return getRole<HTMLButtonElement>(harness.root, "button", { name: `Edit ${name}` })
  }

  async function edit(name: string): Promise<HTMLTextAreaElement> {
    editButton(name).click()
    const editor = await findRole(harness.root, "group", { name: `Edit ${name}` })
    return getRole<HTMLTextAreaElement>(
      editor,
      editor.querySelector("select") ? "combobox" : "textbox",
      {
        name: "New value",
      },
    )
  }

  async function type(field: HTMLTextAreaElement, text: string): Promise<void> {
    enterValue(field, text)
    await nextFrame()
  }

  it("retries a single incident from its card, without a strip", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-writable"])
    const card = await findPart(harness.root, "incident-card")

    expect(queryPart(harness.root, "access", { state: "writable" })?.textContent).toBe("Writable")
    expect(harness.root.querySelector(`${part("strips")} ${part("status-strip")}`)).toBeNull()
    buttonNamed(card, "Retry").click()

    expect(posted("retryIncident")).toEqual([
      { type: "retryIncident", incidentId: WRITABLE_INCIDENT_ID },
    ])
  })

  it("shows a running retry and blocks every other write meanwhile", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-retrying"])
    await findPart(harness.root, "incident-card")

    const card = queryPart(harness.root, "incident-card") ?? harness.root
    expect(buttonNamed(card, "Retrying…").disabled).toBe(true)
    buttonNamed(harness.root, VARIABLES_TAB).click()
    await findRole(harness.root, "button", { name: "Edit amount" })
    expect(editButton("amount").disabled).toBe(true)
  })

  it("reports a retry that failed again in a strip under the header", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-failed-again"])
    const strips = await findPart(harness.root, "strips")

    expect(strips.closest(part("diagram"))).toBeNull()
    expect(getRole(strips, "alert").closest(part("status-strip"))).not.toBeNull()
    expect(getRole(strips, "alert").textContent).toContain("Failed again at Check credit.")
  })

  it("edits text without quotes and sends it as a JSON string", async () => {
    await openVariables()
    const field = await edit("cardExpiry")

    expect(field.value).toBe("03/2025")
    expect(queryPart(harness.root, "editor-hint")?.textContent).toBe('String · was "03/2025"')
    await type(field, "12/2030")
    buttonNamed(harness.root, "Save").click()

    expect(posted("setVariable")).toEqual([
      { type: "setVariable", name: "cardExpiry", valueJson: '"12/2030"' },
    ])
  })

  it("keeps large numbers exact, in the editor and when saving", async () => {
    await openVariables()
    const field = await edit("erpOrderNumber")

    expect(field.value).toBe("9007199254740993")
    expect(buttonNamed(harness.root, "Save").disabled).toBe(true)
    await type(field, "9007199254740995")
    buttonNamed(harness.root, "Save").click()

    expect(posted("setVariable")).toEqual([
      { type: "setVariable", name: "erpOrderNumber", valueJson: "9007199254740995" },
    ])
  })

  it("formats JSON for editing without touching its numbers and saves it compact", async () => {
    await openVariables()
    const field = await edit("customer")

    expect(field.value).toBe('{\n  "id": "C-77",\n  "ledger": 9007199254740993,\n  "tags": []\n}')
    await type(field, field.value.replace("C-77", "C-78"))
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    )

    expect(posted("setVariable")).toEqual([
      {
        type: "setVariable",
        name: "customer",
        valueJson: '{"id":"C-78","ledger":9007199254740993,"tags":[]}',
      },
    ])
  })

  it("closes on Escape, sets null on purpose and offers no pencil for opaque or local values", async () => {
    await openVariables()
    await edit("amount")
    getRole(harness.root, "textbox", { name: "New value" }).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )
    await nextFrame()
    expect(queryRole(harness.root, "group", { name: /^Edit / })).toBeNull()

    await edit("express")
    buttonNamed(harness.root, "Set to null").click()
    expect(posted("setVariable")).toEqual([
      { type: "setVariable", name: "express", valueJson: "null" },
    ])

    expect(queryRole(harness.root, "button", { name: "Edit invoice" })).toBeNull()
    expect(queryRole(harness.root, "button", { name: "Edit cardExpiry" })).not.toBeNull()
    expect(getRole(harness.root, "img", { name: /keeps its own cardExpiry/ }).title).toContain(
      "keeps its own cardExpiry",
    )
  })

  it("keeps the editor open with the reason when the change failed, closes it when done", async () => {
    await openVariables()
    const field = await edit("amount")
    await type(field, "99.5")
    buttonNamed(harness.root, "Save").click()

    const target = { kind: "variable", name: "amount" } as const
    harness.publish({
      status: "ready",
      view: {
        ...WRITABLE_INSTANCE,
        write: { status: "failed", target, message: "local refused the change." },
      },
      refreshing: false,
    })
    const error = await findRole(getRole(harness.root, "group", { name: "Edit amount" }), "alert")
    expect(error.textContent).toBe("local refused the change.")
    expect(getRole(harness.root, "textbox", { name: "New value" })).toBe(field)
    expect(field.value).toBe("99.5")
    expect(field.hasAttribute("aria-invalid")).toBe(false)
    expect(field.hasAttribute("aria-describedby")).toBe(false)
    const calm = colourOfVariable(document.activeElement === field ? "--focus" : "--input")
    await vi.waitFor(() => {
      expect(getComputedStyle(field).borderTopColor).toBe(calm)
    })
    expect(getComputedStyle(field).borderTopColor).not.toBe(colourOfVariable("--danger"))

    harness.publish({
      status: "ready",
      view: { ...WRITABLE_INSTANCE, write: { status: "done", target } },
      refreshing: false,
    })
    await vi.waitFor(() => {
      expect(queryRole(harness.root, "group", { name: /^Edit / })).toBeNull()
    })
  })
})

describe("the editor lifecycle", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  async function editAmount(): Promise<HTMLTextAreaElement> {
    harness = mountApp()
    const target = { kind: "variable", name: "amount" } as const
    harness.publish({
      status: "ready",
      view: { ...WRITABLE_INSTANCE, write: { status: "done", target } },
      refreshing: false,
    })
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, VARIABLES_TAB).click()
    await findRole(harness.root, "button", { name: "Edit amount" })
    getRole(harness.root, "button", { name: "Edit amount" }).click()
    const field = await findRole<HTMLTextAreaElement>(harness.root, "textbox", {
      name: "New value",
    })
    enterValue(field, "12.5")
    await nextFrame()
    buttonNamed(harness.root, "Save").click()
    await nextFrame()
    return field
  }

  it("does not close on a done state left from an earlier change", async () => {
    await editAmount()
    expect(queryRole(harness.root, "group", { name: "Edit amount" })).not.toBeNull()
  })

  it("stays open with the text when the user cancels the confirmation", async () => {
    await editAmount()
    const target = { kind: "variable", name: "amount" } as const
    harness.publish({
      status: "ready",
      view: { ...WRITABLE_INSTANCE, write: { status: "cancelled", target } },
      refreshing: false,
    })
    await nextFrame()
    expect(getRole<HTMLTextAreaElement>(harness.root, "textbox", { name: "New value" }).value).toBe(
      "12.5",
    )
    expect(buttonNamed(harness.root, "Save").disabled).toBe(false)
  })
})

describe("a null variable", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("is written as the type the user picks", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-writable"])
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, VARIABLES_TAB).click()
    await findRole(harness.root, "button", { name: "Edit amount" })
    getRole(harness.root, "button", { name: "Edit iban" }).click()
    const field = await findRole<HTMLTextAreaElement>(harness.root, "textbox", {
      name: "New value",
    })
    expect(queryPart(harness.root, "editor-hint")?.textContent).toBe(
      "Null · was null · written as Text",
    )
    enterValue(field, "4117")
    await nextFrame()
    buttonNamed(harness.root, "Save").click()

    const picker = getRole<HTMLSelectElement>(harness.root, "combobox", { name: "Write as" })
    enterValue(picker, "integer")
    await nextFrame()
    const numberField = getRole<HTMLTextAreaElement>(harness.root, "textbox", { name: "New value" })
    enterValue(numberField, "4117")
    await nextFrame()
    buttonNamed(harness.root, "Save").click()

    expect(harness.posted.filter((intent) => intent.type === "setVariable")).toEqual([
      { type: "setVariable", name: "iban", valueJson: '"4117"' },
      { type: "setVariable", name: "iban", valueJson: "4117" },
    ])
  })

  it("shows the shadowing warning inside the editor", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["instance-writable"])
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, VARIABLES_TAB).click()
    await findRole(harness.root, "button", { name: "Edit amount" })
    getRole(harness.root, "button", { name: "Edit cardExpiry" }).click()
    const warning = await findPart(harness.root, "editor-warning")
    expect(warning.textContent).toContain("keeps its own cardExpiry")
  })
})

describe("the JSON layout", () => {
  it("indents without parsing numbers and keeps strings with brackets intact", () => {
    expect(JsonText.pretty('{"a":[1,{"b":"x,[y]"}],"c":{}}')).toBe(
      '{\n  "a": [\n    1,\n    {\n      "b": "x,[y]"\n    }\n  ],\n  "c": {}\n}',
    )
    expect(JsonText.compact('{\n  "big": 9007199254740993\n}')).toBe('{"big":9007199254740993}')
    expect(JsonText.pretty("not json")).toBe("not json")
    expect(JsonText.compact(" not json ")).toBe("not json")
  })
})
