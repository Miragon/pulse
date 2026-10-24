import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { problems } from "../../test/support/catalog-validate.js"
import { loadCatalog } from "./catalog.js"
import { requiredProperties } from "./schema.js"
import type { Schema } from "./types.js"
import { validateBody } from "./validate.js"

const catalog = loadCatalog()

describe("validateBody: types", () => {
  it.each([
    [{ type: "string" }, "x"],
    [{ type: "string" }, ""],
    [{ type: "integer" }, 3],
    [{ type: "integer" }, -0],
    [{ type: "integer" }, 2 ** 53],
    [{ type: "number" }, 1.5],
    [{ type: "number" }, 3],
    [{ type: "boolean" }, false],
    [{ type: "array" }, []],
    [{ type: "object" }, {}],
    [{ type: "object" }, { any: 1 }],
    [{ type: "unknown-type" }, 1],
    [{}, null],
    [{}, [1, "x"]],
    [{ description: "AnyValue" }, { a: 1 }],
    [{ required: ["a"] }, {}],
    [{ items: { type: "string" } }, [1]],
    [{ additionalProperties: false }, { a: 1 }],
  ])("accepts %j with %j", (schema, value) => {
    expect(problems(schema, value)).toEqual([])
  })

  it.each([
    [{ type: "string" }, 1, "expected string, got 1"],
    [{ type: "string" }, true, "expected string, got true"],
    [{ type: "string" }, {}, "expected string, got object"],
    [{ type: "string" }, [], "expected string, got array"],
    [{ type: "integer" }, 1.5, "expected integer, got 1.5"],
    [{ type: "integer" }, "1", 'expected integer, got "1"'],
    [{ type: "number" }, "1", 'expected number, got "1"'],
    [{ type: "number" }, Number.NaN, "expected number, got NaN"],
    [{ type: "number" }, Number.POSITIVE_INFINITY, "expected number, got Infinity"],
    [{ type: "boolean" }, "true", 'expected boolean, got "true"'],
    [{ type: "boolean" }, 0, "expected boolean, got 0"],
    [{ type: "array" }, {}, "expected array, got object"],
    [{ type: "array" }, "a,b", 'expected array, got "a,b"'],
    [{ type: "object" }, [], "expected object, got array"],
    [{ type: "object" }, "x", 'expected object, got "x"'],
    [{ type: "string" }, undefined, "expected string, got undefined"],
  ])("rejects %j with %j", (schema, value, message) => {
    expect(problems(schema, value)).toEqual([{ path: "$", message }])
  })

  it("shortens long strings in messages", () => {
    const long = "x".repeat(41)
    expect(problems({ type: "integer" }, long)).toEqual([
      { path: "$", message: `expected integer, got "${"x".repeat(37)}..."` },
    ])
    const exact = "y".repeat(40)
    expect(problems({ type: "integer" }, exact)).toEqual([
      { path: "$", message: `expected integer, got "${exact}"` },
    ])
  })

  it("checks nothing else after a type mismatch", () => {
    expect(problems({ type: "string", enum: ["a"] }, 1)).toEqual([
      { path: "$", message: "expected string, got 1" },
    ])
  })
})

describe("validateBody: null", () => {
  it("rejects null for typed schemas that are not nullable", () => {
    expect(problems({ type: "string" }, null)).toEqual([
      { path: "$", message: "expected string, got null" },
    ])
    expect(problems({ type: "string", nullable: false }, null)).toHaveLength(1)
  })

  it("accepts null for nullable schemas", () => {
    expect(problems({ type: "string", nullable: true }, null)).toEqual([])
    expect(problems({ type: "string", nullable: true, enum: ["a"] }, null)).toEqual([])
  })

  it("honors nullable on the referencing schema and on the referenced one", () => {
    const schemas = { Plain: { type: "object" }, Nullable: { type: "object", nullable: true } }
    expect(problems({ $ref: "#/components/schemas/Plain" }, null, schemas)).toEqual([
      { path: "$", message: "expected object, got null" },
    ])
    expect(problems({ $ref: "#/components/schemas/Nullable" }, null, schemas)).toEqual([])
    expect(problems({ $ref: "#/components/schemas/Plain", nullable: true }, null, schemas)).toEqual(
      [],
    )
    expect(
      problems({ allOf: [{ $ref: "#/components/schemas/Plain" }], nullable: true }, null, schemas),
    ).toEqual([])
  })
})

describe("validateBody: enum", () => {
  it("accepts listed values", () => {
    expect(problems({ type: "string", enum: ["asc", "desc"] }, "desc")).toEqual([])
    expect(problems({ type: "integer", enum: [1, 2] }, 2)).toEqual([])
  })

  it("lists the choices", () => {
    expect(problems({ type: "string", enum: ["asc", "desc"] }, "ASC")).toEqual([
      { path: "$", message: 'must be one of "asc", "desc", got "ASC"' },
    ])
    expect(problems({ enum: [1, 2] }, 3)).toEqual([
      { path: "$", message: "must be one of 1, 2, got 3" },
    ])
  })

  it("ignores a malformed enum", () => {
    expect(problems({ type: "string", enum: "asc" }, "x")).toEqual([])
  })
})

describe("validateBody: arrays", () => {
  it("validates items with indexed paths", () => {
    const schema = {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
    }
    expect(problems(schema, { ids: ["a", 2, "c", false] })).toEqual([
      { path: "ids[1]", message: "expected string, got 2" },
      { path: "ids[3]", message: "expected string, got false" },
    ])
    expect(problems({ type: "array", items: { type: "integer" } }, [1, "x"])).toEqual([
      { path: "$[1]", message: 'expected integer, got "x"' },
    ])
  })

  it("accepts any items without an items schema", () => {
    expect(problems({ type: "array" }, [1, "x", null])).toEqual([])
  })
})

describe("validateBody: references", () => {
  const schemas: Record<string, Schema> = {
    Node: {
      type: "object",
      properties: {
        name: { type: "string" },
        children: { type: "array", items: { $ref: "#/components/schemas/Node" } },
      },
    },
    A: { $ref: "#/components/schemas/B" },
    B: { $ref: "#/components/schemas/A" },
  }

  it("terminates on recursive schemas and reports deep problems", () => {
    let value: Record<string, unknown> = { name: "leaf", children: [{ name: 1 }] }
    for (let depth = 0; depth < 50; depth++) value = { name: `n${depth}`, children: [value] }
    const result = problems({ $ref: "#/components/schemas/Node" }, value, schemas)
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe(`${"children[0].".repeat(51).slice(0, -1)}.name`)
    expect(result[0]?.message).toBe("expected string, got 1")
  })

  it("terminates on cyclic allOf references", () => {
    const cyclic: Record<string, Schema> = {
      Loop: {
        allOf: [{ $ref: "#/components/schemas/Loop" }],
        properties: { x: { type: "string" } },
      },
    }
    expect(problems({ $ref: "#/components/schemas/Loop" }, { x: 1, other: 2 }, cyclic)).toEqual([
      { path: "x", message: "expected string, got 1" },
      { path: "$", message: 'unknown property "other"' },
    ])
  })

  it("accepts anything for reference loops and unknown references", () => {
    expect(problems({ $ref: "#/components/schemas/A" }, { x: [1] }, schemas)).toEqual([])
    expect(problems({ $ref: "#/components/schemas/Missing" }, 5, schemas)).toEqual([])
  })
})

describe("validateBody: catalog request schemas", () => {
  const jsonOperations = catalog.operations.flatMap((operation) =>
    operation.body?.kind === "json" ? [{ operation, schema: operation.body.schema }] : [],
  )

  it("covers every JSON request body", () => {
    expect(jsonOperations.length).toBeGreaterThan(100)
  })

  it("accepts {} unless properties are required, and then reports exactly those", () => {
    for (const { operation, schema } of jsonOperations) {
      const required = requiredProperties(schema, catalog.schemas)
      expect(validateBody(schema, {}, catalog.schemas), `${operation.operationId} with {}`).toEqual(
        required.map((name) => ({ path: "$", message: `missing required property "${name}"` })),
      )
    }
  })

  it("accepts preset bodies", () => {
    for (const { operation, schema } of jsonOperations) {
      if (operation.preset === undefined) continue
      expect(validateBody(schema, operation.preset, catalog.schemas)).toEqual([])
    }
  })

  it("finds typos and nested problems in real bodies", () => {
    const start = jsonOperations.find(
      (entry) => entry.operation.operationId === "startProcessInstanceByKey",
    )
    const fetch = jsonOperations.find((entry) => entry.operation.operationId === "fetchAndLock")
    if (start === undefined || fetch === undefined) throw new Error("missing operations")
    expect(
      validateBody(
        start.schema,
        {
          busnessKey: "b",
          variables: { amount: { value: 1, type: "Integer", valu: 2 }, flag: { type: 7 } },
          startInstructions: [{ type: "startBeforeActivity", activityId: "a" }, {}],
        },
        catalog.schemas,
      ),
    ).toEqual([
      { path: "$", message: 'unknown property "busnessKey", did you mean "businessKey"?' },
      { path: "variables.amount", message: 'unknown property "valu", did you mean "value"?' },
      { path: "variables.flag.type", message: "expected string, got 7" },
      { path: "startInstructions[1]", message: 'missing required property "type"' },
    ])
    expect(
      validateBody(
        fetch.schema,
        { workerId: "w", maxTasks: 1, topics: [{ topicName: "t" }] },
        catalog.schemas,
      ),
    ).toEqual([{ path: "topics[0]", message: 'missing required property "lockDuration"' }])
  })

  it("never throws for arbitrary JSON against any catalog schema", () => {
    const schemas = jsonOperations.map((entry) => entry.schema)
    fc.assert(
      fc.property(fc.constantFrom(...schemas), fc.jsonValue({ maxDepth: 4 }), (schema, value) => {
        const result = validateBody(schema, value, catalog.schemas)
        expect(Array.isArray(result)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})
