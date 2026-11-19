// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { Checkbox } from "../primitives/checkbox.js"
import { Input } from "../primitives/input.js"
import { Textarea } from "../primitives/textarea.js"
import { Field } from "./field.js"
import { NativeSelect } from "./native-select.js"
import { SearchField } from "./search-field.js"

/**
 * Field wires its label, hint and error to its control (CI §8 "Eingabefelder": the label 4 px
 * above, the hint and the error below, `aria-invalid` and `aria-describedby`), so a screen reader
 * reads them with the control; the entry stays the caller's.
 */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)
const describedBy = (el: Element) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)

describe("Field", () => {
  it("names the control by its label, 4 px above it", () => {
    const { container } = render(
      <Field label="Business key">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText("Business key")
    expect(input.tagName).toBe("INPUT")
    expect(input.id).not.toBe("")
    expect(input.hasAttribute("aria-describedby")).toBe(false)
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    const field = container.querySelector('[data-slot="field"]')
    expect(classes(field)).toEqual(expect.arrayContaining(["flex", "flex-col", "gap-1"]))
    expect(classes(screen.getByText("Business key"))).toEqual(
      expect.arrayContaining(["text-small", "font-semibold", "text-foreground"]),
    )
  })

  it("reads the hint and the error with the control, the hint first, and marks it invalid", () => {
    render(
      <Field id="name" label="Name" hint="Names are case sensitive." error="Enter a name.">
        <Input defaultValue="" />
      </Field>,
    )
    const input = screen.getByLabelText("Name")
    expect(input.id).toBe("name")
    expect(input.getAttribute("aria-describedby")).toBe("name-hint name-error")
    expect(describedBy(input)).toEqual(["Names are case sensitive.", "Enter a name."])
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const hint = document.getElementById("name-hint")
    expect(classes(hint)).toEqual(expect.arrayContaining(["text-small", "text-muted-foreground"]))
    const error = document.getElementById("name-error")
    expect(classes(error)).toEqual(expect.arrayContaining(["text-small", "text-danger-ink"]))
    // The danger icon beside the words, so colour is never the only signal.
    const icon = error?.querySelector("svg")
    expect(icon?.getAttribute("class")).toContain("lucide-circle-alert")
    expect(classes(icon)).toContain("text-danger")
    expect(icon?.getAttribute("width")).toBe("16")
  })

  it("shows an error next to the control and keeps the entry as typed (never clamps it)", () => {
    function Retries() {
      const [text, setText] = useState("3")
      const error = /^\d+$/.test(text) ? undefined : "Enter a whole number, such as 3."
      return (
        <Field label="Retries" error={error}>
          <Input value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
      )
    }
    render(<Retries />)
    const input = screen.getByLabelText<HTMLInputElement>("Retries")
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    fireEvent.change(input, { target: { value: "3.5" } })
    expect(input.value).toBe("3.5")
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(describedBy(input)).toEqual(["Enter a whole number, such as 3."])
    fireEvent.change(input, { target: { value: "4" } })
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("aria-describedby")).toBe(false)
  })

  it("renders no hint or error for an empty slot", () => {
    const { container } = render(
      <Field label="Note" hint="" error={false}>
        <Textarea />
      </Field>,
    )
    expect(container.querySelector('[data-slot="field-hint"]')).toBeNull()
    expect(container.querySelector('[data-slot="field-error"]')).toBeNull()
    expect(screen.getByLabelText("Note").hasAttribute("aria-describedby")).toBe(false)
  })

  it("puts its own ids ahead of the control's, and lets the control keep an aria-invalid it sets", () => {
    render(
      <>
        <p id="note">Applies to the next run.</p>
        <Field label="Topic" hint="The worker's topic.">
          <Input aria-describedby="note" aria-invalid={false} />
        </Field>
      </>,
    )
    const input = screen.getByLabelText("Topic")
    expect(describedBy(input)).toEqual(["The worker's topic.", "Applies to the next run."])
    expect(input.getAttribute("aria-invalid")).toBe("false")
  })

  it("wires every kit control: Textarea, NativeSelect, Checkbox and SearchField", () => {
    render(
      <>
        <Field label="Value" error="Enter JSON.">
          <Textarea />
        </Field>
        <Field label="Compare as" hint="How the value is read.">
          <NativeSelect>
            <option>Text</option>
          </NativeSelect>
        </Field>
        <Field label="Notify me" error="Choose it to continue.">
          <Checkbox />
        </Field>
        <Field label="Find a process" hint="Matches the name and the key.">
          <SearchField value="" onChange={() => {}} />
        </Field>
      </>,
    )
    expect(screen.getByLabelText("Value").tagName).toBe("TEXTAREA")
    expect(describedBy(screen.getByLabelText("Value"))).toEqual(["Enter JSON."])
    expect(screen.getByLabelText("Compare as").tagName).toBe("SELECT")
    expect(describedBy(screen.getByLabelText("Compare as"))).toEqual(["How the value is read."])
    const box = screen.getByRole("checkbox", { name: "Notify me" })
    expect(box.getAttribute("aria-invalid")).toBe("true")
    // The Field's label names the search, not the catalogue's "Search".
    const search = screen.getByRole("searchbox", { name: "Find a process" })
    expect(search.hasAttribute("aria-label")).toBe(false)
    expect(describedBy(search)).toEqual(["Matches the name and the key."])
  })

  it("hands its wiring to a function child for any other control", () => {
    render(
      <Field label="Due date" hint="Your local time." error="Enter a date after today.">
        {(control) => <input type="date" {...control} />}
      </Field>,
    )
    const input = screen.getByLabelText("Due date")
    expect(input.getAttribute("type")).toBe("date")
    expect(describedBy(input)).toEqual(["Your local time.", "Enter a date after today."])
    expect(input.getAttribute("aria-invalid")).toBe("true")
  })

  it("turns its label quiet while the control is disabled", () => {
    const { container } = render(
      <Field label="Engine" className="w-full">
        <NativeSelect disabled>
          <option>local</option>
        </NativeSelect>
      </Field>,
    )
    expect(classes(container.querySelector('[data-slot="field"]'))).toEqual(
      expect.arrayContaining(["group/field", "w-full"]),
    )
    expect(classes(screen.getByText("Engine"))).toContain(
      "group-has-[:disabled]/field:text-muted-foreground",
    )
  })
})
