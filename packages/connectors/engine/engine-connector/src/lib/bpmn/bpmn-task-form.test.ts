import { describe, expect, it } from "vitest"
import { extractEmbeddedFormFields, formFieldSubmitRules } from "./bpmn-task-form.js"

const bpmn = (fields: string) => `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <bpmn:process id="p">
    <bpmn:userTask id="other"><bpmn:extensionElements><camunda:formData>
      <camunda:formField id="unrelated" type="string" />
    </camunda:formData></bpmn:extensionElements></bpmn:userTask>
    <bpmn:userTask id="review" name="Review">
      <bpmn:extensionElements>
        <camunda:formData>${fields}</camunda:formData>
      </bpmn:extensionElements>
    </bpmn:userTask>
  </bpmn:process>
</bpmn:definitions>`

describe("extractEmbeddedFormFields", () => {
  it("parses the standard required and readonly constraints", () => {
    const xml = bpmn(`
      <camunda:formField id="amount" label="Amount" type="long">
        <camunda:validation>
          <camunda:constraint name="required" />
          <camunda:constraint name="min" config="1" />
        </camunda:validation>
      </camunda:formField>
      <camunda:formField id="customer" type="string">
        <camunda:validation><camunda:constraint name="readonly"/></camunda:validation>
      </camunda:formField>
      <camunda:formField id="note" type="string" />`)
    expect(extractEmbeddedFormFields(xml, "review")).toEqual([
      { name: "amount", label: "Amount", type: "Long", required: true, source: "form-data" },
      { name: "customer", type: "String", readonly: true, source: "form-data" },
      { name: "note", type: "String", source: "form-data" },
    ])
  })

  it("still honours the legacy readonly property", () => {
    const xml = bpmn(`
      <camunda:formField id="customer" type="string">
        <camunda:properties><camunda:property id="readonly" value="true" /></camunda:properties>
      </camunda:formField>
      <camunda:formField id="other" type="string">
        <camunda:properties><camunda:property id="readonly" value="false" /></camunda:properties>
      </camunda:formField>`)
    const [customer, other] = extractEmbeddedFormFields(xml, "review")
    expect(customer.readonly).toBe(true)
    expect(other.readonly).toBeUndefined()
  })

  it("ignores constraints outside camunda:validation", () => {
    const xml = bpmn(`
      <camunda:formField id="x" type="string">
        <camunda:properties><camunda:property id="constraint" value="required" /></camunda:properties>
      </camunda:formField>`)
    expect(extractEmbeddedFormFields(xml, "review")[0].required).toBeUndefined()
  })

  it("types a date field as Date, so a submit never rewrites it as a String", () => {
    const xml = bpmn(`<camunda:formField id="due" type="date" />`)
    expect(extractEmbeddedFormFields(xml, "review")[0].type).toBe("Date")
  })

  it("maps the other built-in form types and keeps custom ones", () => {
    const xml = bpmn(`
      <camunda:formField id="b" type="boolean" />
      <camunda:formField id="d" type="double" />
      <camunda:formField id="e" type="enum">
        <camunda:value id="a" name="Alpha" /><camunda:value id="b" name="Beta" />
      </camunda:formField>
      <camunda:formField id="c" type="customType" />`)
    expect(extractEmbeddedFormFields(xml, "review").map((f) => f.type)).toEqual([
      "Boolean",
      "Double",
      "String",
      "customType",
    ])
  })

  it("returns no fields for an unknown task or a task without formData", () => {
    expect(extractEmbeddedFormFields(bpmn(""), "missing")).toEqual([])
    expect(
      extractEmbeddedFormFields(bpmn('<camunda:formField type="string" />'), "review"),
    ).toEqual([])
  })
})

describe("formFieldSubmitRules", () => {
  it("names the fields a submit would default, and the ones it may not send", () => {
    const xml = bpmn(`
      <camunda:formField id="priority" type="long" defaultValue="50" />
      <camunda:formField id="approved" type="boolean" defaultValue="\${false}">
        <camunda:validation><camunda:constraint name="readonly" /></camunda:validation>
      </camunda:formField>
      <camunda:formField id="legacy" type="string" defaultValue="x">
        <camunda:properties><camunda:property id="readonly" value="true" /></camunda:properties>
      </camunda:formField>
      <camunda:formField id="note" type="string" />`)
    expect(formFieldSubmitRules(xml, "review")).toEqual([
      { name: "priority", hasDefault: true, engineReadonly: false },
      { name: "approved", hasDefault: true, engineReadonly: true },
      // The legacy property is a UI hint: the engine submits (and defaults) the field.
      { name: "legacy", hasDefault: true, engineReadonly: false },
      { name: "note", hasDefault: false, engineReadonly: false },
    ])
  })

  it("has no rules for an unknown task, a task without formData or a field without id", () => {
    expect(formFieldSubmitRules(bpmn('<camunda:formField id="a" />'), "missing")).toEqual([])
    expect(formFieldSubmitRules(bpmn(""), "review")).toEqual([])
    expect(formFieldSubmitRules(bpmn('<camunda:formField defaultValue="1" />'), "review")).toEqual(
      [],
    )
  })
})
