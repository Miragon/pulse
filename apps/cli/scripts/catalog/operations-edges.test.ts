/** extractOperations edge cases, clean, responseKind and the operations of the generated catalog. */

import { describe, expect, it } from "vitest"
import { json, ref, single } from "../../test/support/openapi-fixture.js"
import type { Catalog } from "../../src/catalog/types.js"
import { buildCatalog } from "./build-catalog.js"
import { readPatchedSpec } from "./files.js"
import type { OpenApiDocument, OpenApiPathItem } from "./openapi.js"
import { clean, extractOperations, responseKind } from "./operations.js"
import { SPEC_URL } from "./render.js"

describe("extractOperations edge cases", () => {
  const bare = (paths: Record<string, OpenApiPathItem>): OpenApiDocument => ({
    info: { title: "t", version: "1" },
    paths,
  })

  it("works for specs without components", () => {
    const [operation] = extractOperations(
      bare({
        "/thing/{id}": {
          post: {
            operationId: "postThing",
            tags: ["Thing"],
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
              { name: "q", in: "query", schema: { type: "string" } },
            ],
            requestBody: json({ type: "object", properties: { a: { type: "string" } } }),
            responses: {
              "200": json({ type: "object", properties: { id: {}, docXml: {} } }),
            },
          },
        },
      }),
    )
    expect(operation?.params.map((param) => param.name)).toEqual(["id", "q"])
    expect(operation?.body?.fields.map((field) => field.name)).toEqual(["a"])
    expect(operation?.unwrap).toBe("docXml")
  })

  it("orders path parameters with long names by their position in the path", () => {
    const operation = single(
      {
        operationId: "x",
        tags: ["X"],
        parameters: [
          { name: "second", in: "path", required: true, schema: { type: "string" } },
          { name: "first", in: "path", required: true, schema: { type: "string" } },
        ],
      },
      "/a/{first}/b/{second}",
    )
    expect(operation.params.map((param) => param.name)).toEqual(["first", "second"])
  })

  it("keeps optional parameter properties absent", () => {
    const operation = single({
      operationId: "x",
      tags: ["X"],
      parameters: [{ name: "plain", in: "query", schema: { type: "string" } }],
      responses: { "204": { description: "none" } },
    })
    expect(operation.params).toStrictEqual([
      {
        name: "plain",
        in: "query",
        flag: "plain",
        type: "string",
        required: false,
        description: "",
      },
    ])
    expect(operation.responses).toStrictEqual([
      { status: 204, kind: "none", contentTypes: [], description: "none" },
    ])
  })

  it("fails without tags", () => {
    expect(() => single({ operationId: "x" })).toThrow(
      new Error("GET /thing needs an operationId and a tag"),
    )
  })

  it("fails for request bodies without content", () => {
    expect(() => single({ operationId: "x", tags: ["X"], requestBody: {} }, "/x", "post")).toThrow(
      new Error("x: unsupported request body content types"),
    )
  })

  it("unwraps the JSON response even when another success response comes first", () => {
    const operation = single({
      operationId: "x",
      tags: ["X"],
      responses: {
        "200": { content: { "text/plain": { schema: { type: "string" } } } },
        "201": json(ref("schemas", "XmlDto")),
      },
    })
    expect(operation.unwrap).toBe("bpmn20Xml")
  })
})

describe("clean", () => {
  it("normalizes line endings and trims", () => {
    expect(clean("  a\r\nb\r\n  ")).toBe("a\nb")
    expect(clean("")).toBe("")
  })
})

describe("responseKind", () => {
  it.each([
    [[], "none"],
    [["application/json"], "json"],
    [["application/xml", "application/json"], "json"],
    [["application/octet-stream"], "binary"],
    [["image/png"], "binary"],
    [["image/*"], "binary"],
    [["*/*"], "binary"],
    [["text/plain"], "text"],
    [["text/csv", "application/csv"], "text"],
    [["application/xhtml+xml"], "text"],
    [["application/hal+json"], "text"],
  ])("%j → %s", (contentTypes, kind) => {
    expect(responseKind(contentTypes)).toBe(kind)
  })
})

let cachedCatalog: Catalog | undefined

/**
 * The catalog built from the vendored spec. Built lazily inside the first test that needs it, never
 * at load time, so mutation testing attributes the generator code to tests.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL)
  return cachedCatalog
}

describe("operations in the generated catalog", () => {
  const find = (id: string) =>
    realCatalog().operations.find((operation) => operation.operationId === id && !operation.preset)

  it("orders path arguments by their position in the path", () => {
    for (const operation of realCatalog().operations) {
      const names = operation.params
        .filter((param) => param.in === "path")
        .map((param) => param.name)
      const inPath = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
      expect(names).toEqual(inPath)
      const firstQuery = operation.params.findIndex((param) => param.in === "query")
      if (firstQuery >= 0) expect(firstQuery).toBe(names.length)
    }
  })

  it("unwraps the BPMN and DMN XML responses", () => {
    expect(find("getProcessDefinitionBpmn20XmlByKey")?.unwrap).toBe("bpmn20Xml")
    expect(find("getDecisionDefinitionDmnXmlById")?.unwrap).toBe("dmnXml")
    expect(
      realCatalog().operations.filter((operation) => operation.unwrap !== undefined),
    ).toHaveLength(9)
  })

  it("detects trueOnly flags only on boolean query parameters", () => {
    const trueOnly = realCatalog().operations.flatMap((operation) =>
      operation.params.filter((param) => param.trueOnly === true),
    )
    expect(trueOnly.length).toBeGreaterThan(100)
    expect(trueOnly.every((param) => param.type === "boolean" && param.in === "query")).toBe(true)
    const latest = find("getProcessDefinitions")?.params.find(
      (param) => param.name === "latestVersion",
    )
    expect(latest?.trueOnly).toBe(true)
  })

  it("classifies response kinds", () => {
    expect(find("getProcessInstances")?.responses[0]?.kind).toBe("json")
    expect(find("deleteProcessInstance")?.responses[0]?.kind).toBe("none")
    expect(find("getProcessInstanceVariableBinary")?.responses[0]?.kind).toBe("binary")
  })
})
