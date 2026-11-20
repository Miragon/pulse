import { afterEach, describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import {
  type DefinitionView,
  type InstanceListFilter,
  type PanelState,
  type WebviewIntent,
  MAX_VARIABLE_CONDITIONS,
  VariableConditionRules,
} from "../../src/core/protocol/index.js"
import {
  DATE_PATTERN,
  MAX_CONDITIONS,
  NUMBER_PATTERN,
  OPERATORS_OF,
  VariableDraft,
} from "../../src/webview/screens/variable-draft.js"
import { SELECTING_DEFINITION } from "../../dev/webview/fixtures/bulk.js"
import { DEFINITION_VIEW, FILTERED_DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import {
  buttonNamed,
  enterValue,
  type Harness,
  mountApp,
  nextFrame,
  radioNamed,
  waitForElement,
} from "./harness.js"

const CONDITIONS: InstanceListFilter = {
  scope: "running",
  variables: [
    { name: "route", operator: "equals", value: "review" },
    { name: "amount", operator: "greaterThan", value: "100" },
  ],
}

const LABELS = ['route = "review"', "amount > 100"]

function ready(view: DefinitionView): PanelState {
  return { status: "ready", refreshing: false, view }
}

function lastFilter(harness: Harness): InstanceListFilter | undefined {
  const filters = harness.posted.filter(
    (intent): intent is Extract<WebviewIntent, { type: "filterInstances" }> =>
      intent.type === "filterInstances",
  )
  return filters.at(-1)?.filter
}

function labelled(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("[aria-label]")].find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  if (found === undefined) {
    throw new Error(`Nothing is labelled ${label}.`)
  }
  return found
}

async function openDialog(harness: Harness, opener: HTMLElement): Promise<HTMLDialogElement> {
  opener.click()
  return waitForElement<HTMLDialogElement>(harness.root, "dialog[open]")
}

function field(dialog: HTMLDialogElement, label: string): HTMLInputElement & HTMLSelectElement {
  const target = [...dialog.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === label,
  )
  return dialog.querySelector(`#${CSS.escape(target?.htmlFor ?? "")}`)!
}

function optionsOf(dialog: HTMLDialogElement, label: string): (string | null)[] {
  return [...field(dialog, label).options].map((option) => option.textContent)
}

function disabledOf(dialog: HTMLDialogElement, label: string): (string | null)[] {
  return [...field(dialog, label).options]
    .filter((option) => option.disabled)
    .map((option) => option.textContent)
}

function labelColour(dialog: HTMLDialogElement, label: string): string {
  const target = [...dialog.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === label,
  )
  return target === undefined ? "" : getComputedStyle(target).color
}

async function apply(dialog: HTMLDialogElement): Promise<void> {
  await nextFrame()
  buttonNamed(dialog, "Apply").click()
}

describe("the variable search of the definition panel", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("adds a condition from the dialog and keeps the other filters", async () => {
    harness = mountApp()
    harness.publish(ready(FILTERED_DEFINITION_VIEW))
    const opener = await vi.waitFor(() => labelled(harness.root, "Filter by variables"))

    const dialog = await openDialog(harness, opener)
    enterValue(field(dialog, "Name"), " amount ")
    enterValue(field(dialog, "Operator"), "greaterThan")
    enterValue(field(dialog, "Value"), "100")
    await apply(dialog)

    await vi.waitFor(() => {
      expect(harness.root.querySelector("dialog")).toBeNull()
    })
    expect(lastFilter(harness)).toEqual({
      ...FILTERED_DEFINITION_VIEW.filter,
      variables: [{ name: "amount", operator: "greaterThan", value: "100" }],
    })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(opener)
    })
  })

  it("says what is wrong instead of applying", async () => {
    harness = mountApp()
    harness.publish(ready(DEFINITION_VIEW))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    await apply(dialog)
    await vi.waitFor(() => {
      expect(dialog.textContent).toContain("Enter a variable name.")
    })
    expect(field(dialog, "Name").getAttribute("aria-invalid")).toBe("true")
    expect(document.activeElement).toBe(field(dialog, "Name"))

    enterValue(field(dialog, "Name"), "amount")
    enterValue(field(dialog, "Compare as"), "number")
    enterValue(field(dialog, "Value"), "a lot")
    await apply(dialog)
    await vi.waitFor(() => {
      expect(dialog.textContent).toContain("Enter a number, for example 42 or 9.5.")
    })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field(dialog, "Value"))
    })
    expect(field(dialog, "Name").hasAttribute("aria-invalid")).toBe(false)
    expect(lastFilter(harness)).toBeUndefined()
  })

  it("compares a date as a point in time with a date and time field", async () => {
    harness = mountApp()
    harness.publish(ready(DEFINITION_VIEW))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    enterValue(field(dialog, "Name"), "dueAt")
    enterValue(field(dialog, "Compare as"), "date")
    await nextFrame()
    expect(field(dialog, "Value").type).toBe("datetime-local")
    expect([...field(dialog, "Operator").options].map((option) => option.textContent)).toEqual([
      "is",
      "is not",
      "is after",
      "is before",
    ])
    enterValue(field(dialog, "Operator"), "lessThan")
    enterValue(field(dialog, "Value"), "2026-03-15T10:00")
    await apply(dialog)

    await vi.waitFor(() => {
      expect(lastFilter(harness)?.variables).toEqual([
        { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", as: "date" },
      ])
    })
  })

  it("offers a date comparison and greater or less than disabled where the engine refuses them, with the reason (owner, 2026-11-20)", async () => {
    harness = mountApp()
    harness.publish(ready({ ...DEFINITION_VIEW, refusedVariableConditions: ["ordering", "date"] }))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    expect(optionsOf(dialog, "Compare as")).toEqual([
      "Automatic",
      "Text",
      "Number",
      "True or false",
      "Date and time",
      "Null",
    ])
    expect(disabledOf(dialog, "Compare as")).toEqual(["Date and time"])
    expect(disabledOf(dialog, "Operator")).toEqual(["is greater than", "is less than"])
    expect(dialog.textContent).toContain("This engine can't compare dates.")
    expect(dialog.textContent).toContain("This engine can't search for greater or less than.")
    enterValue(field(dialog, "Compare as"), "number")
    await nextFrame()
    expect(disabledOf(dialog, "Operator")).toEqual(["is greater than", "is less than"])
    expect(labelColour(dialog, "Compare as")).toBe(labelColour(dialog, "Name"))
    expect(labelColour(dialog, "Operator")).toBe(labelColour(dialog, "Name"))
  })

  it("keeps is after and is before where the engine refuses only greater and less than", async () => {
    harness = mountApp()
    harness.publish(ready({ ...DEFINITION_VIEW, refusedVariableConditions: ["ordering"] }))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    expect(disabledOf(dialog, "Compare as")).toEqual([])
    enterValue(field(dialog, "Compare as"), "number")
    await nextFrame()
    expect(disabledOf(dialog, "Operator")).toEqual(["is greater than", "is less than"])
    enterValue(field(dialog, "Compare as"), "date")
    await nextFrame()
    expect(optionsOf(dialog, "Operator")).toEqual(["is", "is not", "is after", "is before"])
    expect(disabledOf(dialog, "Operator")).toEqual([])
  })

  it("asks for no value when it compares with null", async () => {
    harness = mountApp()
    harness.publish(ready(DEFINITION_VIEW))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    enterValue(field(dialog, "Name"), "giftNote")
    enterValue(field(dialog, "Value"), "leftover")
    enterValue(field(dialog, "Compare as"), "null")
    await nextFrame()
    expect([...dialog.querySelectorAll("label")].map((label) => label.textContent)).not.toContain(
      "Value",
    )
    expect([...field(dialog, "Operator").options].map((option) => option.textContent)).toEqual([
      "is null",
      "is not null",
    ])
    await apply(dialog)

    await vi.waitFor(() => {
      expect(lastFilter(harness)?.variables).toEqual([
        { name: "giftNote", operator: "equals", value: "", as: "null" },
      ])
    })
  })

  it("shows every condition as a chip that edits or removes it", async () => {
    harness = mountApp()
    harness.publish(ready({ ...DEFINITION_VIEW, filter: CONDITIONS, variableLabels: LABELS }))
    await vi.waitFor(() => labelled(harness.root, "Filter by variables, 2 conditions"))

    const remove = labelled(harness.root, "Remove condition amount > 100")
    expect(remove.title).toBe("Remove condition amount > 100")
    remove.click()
    expect(lastFilter(harness)).toEqual({ scope: "running", variables: [CONDITIONS.variables![0]] })

    const chip = labelled(harness.root, 'Edit condition route = "review"')
    const dialog = await openDialog(harness, chip)
    expect(field(dialog, "Name").value).toBe("route")
    enterValue(field(dialog, "Value"), "charge")
    await apply(dialog)

    await vi.waitFor(() => {
      expect(lastFilter(harness)).toEqual({
        scope: "running",
        variables: [
          { name: "route", operator: "equals", value: "charge" },
          CONDITIONS.variables![1],
        ],
      })
    })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(chip)
    })
  })

  it("keeps the chips in a narrow panel", async () => {
    harness = mountApp({ width: 600 })
    harness.publish(ready({ ...DEFINITION_VIEW, filter: CONDITIONS, variableLabels: LABELS }))

    const chip = await vi.waitFor(() => labelled(harness.root, "Remove condition amount > 100"))
    expect(chip.getClientRects().length).toBeGreaterThan(0)
  })

  it("keeps the conditions when the scope changes", async () => {
    harness = mountApp()
    harness.publish(ready({ ...DEFINITION_VIEW, filter: CONDITIONS, variableLabels: LABELS }))
    await vi.waitFor(() => labelled(harness.root, "Filter by variables, 2 conditions"))

    radioNamed(harness.root, "Ended").click()

    expect(lastFilter(harness)).toEqual({ ...CONDITIONS, scope: "ended" })
  })

  it("closes the dialog with Escape and keeps the selection", async () => {
    harness = mountApp()
    harness.publish(ready(SELECTING_DEFINITION))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    await userEvent.keyboard("{Escape}")

    await vi.waitFor(() => {
      expect(dialog.isConnected).toBe(false)
    })
    expect(harness.posted.some((intent) => intent.type === "clearSelection")).toBe(false)
  })

  it("offers to clear the conditions when nothing matches", async () => {
    harness = mountApp()
    harness.publish(
      ready({ ...DEFINITION_VIEW, instances: [], filter: CONDITIONS, variableLabels: LABELS }),
    )

    const clear = await vi.waitFor(() => buttonNamed(harness.root, "Clear variable conditions"))
    expect(harness.root.textContent).toContain(
      "No running instances match these variable conditions. An engine that keeps no variable history finds none.",
    )
    clear.click()

    expect(lastFilter(harness)).toEqual({ scope: "running" })
  })

  it("asks the host for the variable names and suggests them", async () => {
    harness = mountApp()
    harness.publish(ready({ ...DEFINITION_VIEW, variableNames: ["amount", "route"] }))
    const dialog = await openDialog(
      harness,
      await vi.waitFor(() => labelled(harness.root, "Filter by variables")),
    )

    expect(harness.posted).toContainEqual({ type: "suggestVariableNames" })
    const name = field(dialog, "Name")
    const options = [...(name.list?.options ?? [])].map((option) => option.value)
    expect(options).toEqual(["amount", "route"])
  })

  it("words a condition as the core labels it until the host labels it", async () => {
    const conditions = [
      ...(CONDITIONS.variables ?? []),
      { name: "route", operator: "like", value: "rev%" },
      { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", as: "date" },
      { name: "giftNote", operator: "notEquals", value: "", as: "null" },
    ] as const
    harness = mountApp()
    harness.publish(
      ready({ ...DEFINITION_VIEW, filter: { scope: "running", variables: conditions } }),
    )

    for (const condition of conditions) {
      await vi.waitFor(() =>
        labelled(harness.root, `Remove condition ${VariableConditionRules.label(condition)}`),
      )
    }
  })
})

describe("the variable dialog", () => {
  it("follows the protocol's rules", () => {
    expect(NUMBER_PATTERN).toBe(VariableConditionRules.NUMBER_PATTERN)
    expect(DATE_PATTERN).toBe(VariableConditionRules.DATE_PATTERN)
    expect(MAX_CONDITIONS).toBe(MAX_VARIABLE_CONDITIONS)
    for (const type of ["text", "number", "boolean", "date", "null"] as const) {
      expect(OPERATORS_OF[type]).toEqual(VariableConditionRules.operatorsOf(type))
    }
  })

  it.each([
    [{ name: "amount", operator: "greaterThan", value: "abc", compareAs: "auto" }, "value"],
    [{ name: "amount", operator: "equals", value: "4x", compareAs: "number" }, "value"],
    [{ name: "amount", operator: "equals", value: "abc", compareAs: "auto" }, undefined],
    [{ name: "  ", operator: "equals", value: "abc", compareAs: "text" }, "name"],
    [{ name: "dueAt", operator: "lessThan", value: "", compareAs: "date" }, "value"],
    [
      { name: "dueAt", operator: "lessThan", value: "2026-03-15T10:00", compareAs: "date" },
      undefined,
    ],
    [{ name: "giftNote", operator: "equals", value: "", compareAs: "null" }, undefined],
  ] as const)("finds in %o a wrong %s", (draft, wrong) => {
    expect(Object.keys(VariableDraft.errors(draft, 0))).toEqual(wrong === undefined ? [] : [wrong])
  })

  it("offers date and ordering, and names them refused where the engine refuses them (owner, 2026-11-20)", () => {
    expect(VariableDraft.compareAsOptions()).toContain("date")
    expect(VariableDraft.refusedKind("date", undefined, ["date"])).toBe("date")
    expect(VariableDraft.refusedKind("date", undefined, [])).toBeUndefined()
    expect(VariableDraft.operatorsOf("number")).toEqual(OPERATORS_OF.number)
    expect(VariableDraft.refusedKind("number", "greaterThan", ["ordering"])).toBe("ordering")
    expect(VariableDraft.refusedKind("auto", "like", ["ordering"])).toBeUndefined()
    expect(VariableDraft.refusedKind("date", "greaterThan", ["ordering"])).toBeUndefined()
  })

  it("refuses a sixth condition", () => {
    const draft = VariableDraft.from({ name: "route", operator: "equals", value: "review" })
    expect(VariableDraft.errors(draft, 5).count).toBe("tooMany")
  })

  it("keeps only the operators a type offers when the type changes", () => {
    const draft = VariableDraft.from({ name: "amount", operator: "greaterThan", value: "4" })
    expect(VariableDraft.withCompareAs(draft, "text")).toMatchObject({ operator: "equals" })
    expect(VariableDraft.withCompareAs(draft, "boolean")).toMatchObject({
      operator: "equals",
      value: "true",
    })
    expect(VariableDraft.withCompareAs(draft, "number")).toMatchObject({ operator: "greaterThan" })
  })
})
