// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SettingsField, SettingsInput } from "./settings.js"
import { FIELD_CONTROL } from "./native-select.js"

afterEach(cleanup)

describe("SettingsField: inline validation (CI §8/§9, U25)", () => {
  it("says what is wrong under the control, marks it invalid and describes it with the line", () => {
    render(
      <SettingsField label="Minimum size" help="Per side of a comparison." error="Enter 1 or more.">
        <SettingsInput defaultValue="abc" />
      </SettingsField>,
    )
    const field = screen.getByRole("textbox", { name: "Minimum size" })
    expect(field.getAttribute("aria-invalid")).toBe("true")
    const error = screen.getByText("Enter 1 or more.")
    const help = screen.getByText("Per side of a comparison.")
    expect(field.getAttribute("aria-describedby")).toBe(`${error.id} ${help.id}`)
    // The danger ink for words on the card, with an icon: colour is not the only signal.
    expect(error.className).toContain("text-danger-ink")
    expect(error.querySelector("svg")?.getAttribute("class")).toContain("lucide-circle-alert")
    expect(FIELD_CONTROL).toContain("aria-invalid:border-danger")
  })

  it("leaves a valid field unmarked, described by its help only", () => {
    render(
      <SettingsField label="Period" help="Used when a view names none.">
        <SettingsInput defaultValue="7d" />
      </SettingsField>,
    )
    const field = screen.getByRole("textbox", { name: "Period" })
    expect(field.hasAttribute("aria-invalid")).toBe(false)
    expect(field.getAttribute("aria-describedby")).toBe(
      screen.getByText("Used when a view names none.").id,
    )
  })

  it("describes a group of controls the same way", () => {
    render(
      <SettingsField label="Engines" group error="Pick one.">
        <span>
          <input type="checkbox" aria-label="prod" />
        </span>
      </SettingsField>,
    )
    const group = screen.getByRole("group", { name: "Engines" })
    expect(group.getAttribute("aria-describedby")).toBe(screen.getByText("Pick one.").id)
  })

  it("adds no description to a bare field", () => {
    render(
      <SettingsField label="Name">
        <SettingsInput defaultValue="x" />
      </SettingsField>,
    )
    expect(screen.getByRole("textbox", { name: "Name" }).hasAttribute("aria-describedby")).toBe(
      false,
    )
  })
})
