import { describe, expect, it } from "vitest"
import { translator, type T } from "../../messages/use-t.js"
import type { TaskFormField, TaskFormSchema } from "../../view-models.js"
import { collectVariables, initialFieldValues, type ManualEntry } from "./values.js"

const t: T = (key, params) => translator("en", key, params)

const field = (name: string, rest: Partial<TaskFormField> = {}): TaskFormField => ({
  name,
  source: "form-data",
  ...rest,
})

const schemaOf = (...fields: TaskFormField[]): TaskFormSchema => ({ taskId: "task-1", fields })

const entry = (name: string, value: string, type = "String"): ManualEntry => ({
  id: `entry-${name}`,
  name,
  value,
  type,
})

describe("collectVariables", () => {
  it("sends the fields, then the variables added by hand, which win a name both give", () => {
    const schema = schemaOf(
      field("amount", { type: "Long" }),
      field("approved", { type: "Boolean" }),
      field("note"),
      field("shown", { readonly: true }),
      field("optional", { type: "Long" }),
    )
    const values = { amount: "42", approved: "true", note: "ok", shown: "kept", optional: "" }
    const entries = [entry(" note ", "by hand"), entry("", "no name"), entry("empty", "")]
    expect(collectVariables(t, schema, values, entries)).toEqual({
      variables: {
        amount: { value: 42, type: "Long" },
        approved: { value: true, type: "Boolean" },
        note: { value: "by hand", type: "String" },
      },
      error: null,
    })
  })

  it("stops at a required field left empty, before any variable added by hand", () => {
    const schema = schemaOf(field("reason", { required: true }))
    expect(collectVariables(t, schema, {}, [entry("count", "x", "Long")])).toEqual({
      error: "Pick a value for reason before you complete the task.",
    })
  })

  it("stops at a value its type refuses, a field's or one added by hand", () => {
    const schema = schemaOf(field("amount", { type: "Long" }))
    expect(collectVariables(t, schema, { amount: "4.2" }, [])).toEqual({
      error: "Invalid value for amount: expected Long. Fix the input, then complete the task.",
    })
    expect(collectVariables(t, schemaOf(), {}, [entry("when", "tomorrow", "Date")])).toEqual({
      error: "Invalid value for when: expected Date. Fix the input, then complete the task.",
    })
  })
})

describe("initialFieldValues", () => {
  it("starts each field at its default value as text, else empty", () => {
    const schema = schemaOf(
      field("count", { defaultValue: 3 }),
      field("data", { defaultValue: { a: 1 } }),
      field("none", { defaultValue: null }),
      field("free"),
    )
    expect(initialFieldValues(schema)).toEqual({ count: "3", data: '{"a":1}', none: "", free: "" })
  })
})
