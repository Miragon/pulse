import { describe, expect, test } from "vitest"
import { C7BpmnDialect } from "../../src/adapters/c7/c7-bpmn-dialect.js"
import { C8BpmnDialect } from "../../src/adapters/c8/c8-bpmn-dialect.js"
import type { BpmnDialect } from "../../src/contract/index.js"

interface Descriptor {
  readonly prefix: string
  readonly types: readonly {
    readonly name: string
    readonly properties?: readonly { readonly name: string }[]
  }[]
}

class Vocabulary {
  readonly types: ReadonlySet<string>
  private readonly properties: ReadonlySet<string>
  private readonly prefix: string

  constructor(dialect: BpmnDialect) {
    const descriptor = dialect.descriptor as unknown as Descriptor
    this.prefix = `${descriptor.prefix}:`
    this.types = new Set(descriptor.types.map((type) => `${this.prefix}${type.name}`))
    this.properties = new Set(
      descriptor.types.flatMap((type) => (type.properties ?? []).map((property) => property.name)),
    )
  }

  knowsProperty(name: string): boolean {
    const local = name.startsWith(this.prefix) ? name.slice(this.prefix.length) : name
    return !local.includes(":") && this.properties.has(local)
  }
}

describe.each([
  ["Camunda 7", new C7BpmnDialect()],
  ["Camunda 8", new C8BpmnDialect()],
])("the BPMN dialect of %s", (_, dialect) => {
  const vocabulary = new Vocabulary(dialect)

  test("names only extension elements its own descriptor defines", () => {
    const named = [
      ...dialect.implementations.flatMap((rule) =>
        rule.extension === undefined ? [] : [rule.extension],
      ),
      ...dialect.mappings.map((rule) => rule.container),
      ...dialect.errorDefinitions,
    ]
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((name) => !vocabulary.types.has(name))).toEqual([])
  })

  test("reads only properties its own descriptor defines", () => {
    const read = [
      ...dialect.implementations.flatMap((rule) => [
        rule.property,
        ...(rule.when === undefined ? [] : [rule.when.property]),
      ]),
      ...dialect.mappings.flatMap((rule) => [rule.inputs, rule.outputs, rule.target, rule.source]),
    ]
    expect(read.filter((name) => !vocabulary.knowsProperty(name))).toEqual([])
  })
})
