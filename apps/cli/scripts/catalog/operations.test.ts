import { describe, expect, it } from "vitest"
import { byId, document, json, ref, single, SPEC } from "../../test/support/openapi-fixture.js"
import { extractOperations } from "./operations.js"

describe("extractOperations", () => {
  it("fails for path item keys it does not know, such as PATCH", () => {
    const spec = document({ "/x": { patch: { operationId: "patchX", tags: ["X"] } } })
    expect(() => extractOperations(spec)).toThrow('/x: unsupported path item key "patch"')
    const head = document({ "/y": { head: { operationId: "headY", tags: ["Y"] } } })
    expect(() => extractOperations(head)).toThrow('/y: unsupported path item key "head"')
  })

  it("extracts GET, POST, PUT and DELETE operations in path order, never OPTIONS", () => {
    const operations = extractOperations(SPEC)
    expect(operations.map((operation) => `${operation.method} ${operation.operationId}`)).toEqual([
      "GET getSub",
      "DELETE deleteSub",
      "POST createThing",
      "PUT uploadThing",
      "GET getEngines",
      "GET getVersion",
    ])
  })

  it("copies the basic properties and cleans texts", () => {
    const operation = byId("getSub")
    expect(operation).toMatchObject({
      operationId: "getSub",
      tag: "Thing",
      method: "GET",
      path: "/thing/{a}/sub/{b}",
      summary: "Get a sub thing.",
      description: "Line 1\nLine 2",
      deprecated: false,
      effect: "read",
      engineScoped: true,
    })
    expect(operation).not.toHaveProperty("body")
  })

  it("defaults summary, description and deprecated", () => {
    expect(byId("deleteSub")).toMatchObject({
      summary: "deleteSub",
      description: "",
      deprecated: true,
      effect: "delete",
      params: [
        { name: "b", in: "path", flag: "b", type: "string", required: true, description: "" },
        {
          name: "tenantId",
          in: "query",
          flag: "tenant-id",
          type: "string",
          required: false,
          description: "path level",
        },
      ],
    })
  })

  it("orders path parameters by their position in the path, query parameters after them", () => {
    expect(byId("getSub").params.map((param) => `${param.in}:${param.name}`)).toEqual([
      "path:a",
      "path:b",
      "query:tenantId",
      "query:withoutTenant",
      "query:count",
      "query:state",
      "query:filter",
      "query:active",
      "query:label",
      "query:ratio",
    ])
  })

  it("lets operation parameters replace path item parameters with the same name", () => {
    const tenant = byId("getSub").params.find((param) => param.name === "tenantId")
    expect(tenant?.description).toBe("operation level")
  })

  it("types query parameters and keeps format and enum", () => {
    const params = Object.fromEntries(byId("getSub").params.map((param) => [param.name, param]))
    expect(params.count).toEqual({
      name: "count",
      in: "query",
      flag: "count",
      type: "integer",
      required: true,
      description: "",
      format: "int32",
    })
    expect(params.state).toMatchObject({ type: "string", enum: ["A", "B", "3"] })
    expect(params.filter?.type).toBe("object")
    expect(params.ratio?.type).toBe("number")
    expect(params.label?.type).toBe("string")
  })

  it("gives the Java Integer paging and priority parameters the int32 format", () => {
    const integer = { type: "integer" }
    const operation = single({
      operationId: "getThings",
      tags: ["Thing"],
      parameters: [
        { name: "firstResult", in: "query", schema: integer },
        { name: "maxResults", in: "query", schema: integer },
        { name: "priority", in: "query", schema: integer },
        { name: "minPriority", in: "query", schema: integer },
        { name: "maxPriority", in: "query", schema: integer },
        { name: "other", in: "query", schema: integer },
        { name: "maxResultsText", in: "query", schema: { type: "string" } },
        { name: "interval", in: "query", schema: { type: "integer", format: "int64" } },
      ],
    })
    expect(operation.params.map((param) => param.format)).toEqual([
      "int32",
      "int32",
      "int32",
      "int32",
      "int32",
      undefined,
      undefined,
      "int64",
    ])
  })

  it("detects boolean filters that may only be true", () => {
    const params = Object.fromEntries(byId("getSub").params.map((param) => [param.name, param]))
    expect(params.withoutTenant).toMatchObject({
      type: "boolean",
      flag: "without-tenant",
      trueOnly: true,
    })
    expect(params.active).not.toHaveProperty("trueOnly")
    expect(params.label).not.toHaveProperty("trueOnly")
  })

  it.each([
    "Value may only be `true`, as `false` is the default behavior.",
    "value may only be true",
    "VALUE MAY ONLY BE `TRUE`",
  ])("detects trueOnly in %j", (description) => {
    const operation = single({
      operationId: "x",
      tags: ["X"],
      parameters: [{ name: "flag", in: "query", description, schema: { type: "boolean" } }],
    })
    expect(operation.params[0]?.trueOnly).toBe(true)
  })

  it("marks /engine and /version as not engine scoped", () => {
    expect(byId("getEngines").engineScoped).toBe(false)
    expect(byId("getVersion").engineScoped).toBe(false)
    expect(byId("createThing").engineScoped).toBe(true)
  })

  it("keeps only success responses and resolves response references", () => {
    expect(byId("getSub").responses).toEqual([
      {
        status: 200,
        kind: "json",
        contentTypes: ["application/json"],
        description: "OK",
        schema: ref("schemas", "XmlDto"),
      },
    ])
    expect(byId("createThing").responses).toEqual([
      {
        status: 200,
        kind: "json",
        contentTypes: ["application/json"],
        description: "",
        schema: { type: "object" },
      },
      { status: 201, kind: "none", contentTypes: [], description: "created" },
    ])
    expect(byId("getEngines").responses).toEqual([])
  })

  it("builds JSON and multipart bodies with flags", () => {
    expect(byId("createThing").body).toMatchObject({
      kind: "json",
      fields: [
        { name: "name", flag: "name" },
        { name: "url", flag: "body-url" },
      ],
    })
    expect(byId("uploadThing").body).toMatchObject({
      kind: "multipart",
      fields: [{ name: "data", flag: "data", type: "binary" }],
      resources: false,
    })
  })

  it("detects XML documents worth unwrapping", () => {
    expect(byId("getSub").unwrap).toBe("bpmn20Xml")
    expect(byId("createThing")).not.toHaveProperty("unwrap")
    for (const schema of ["ThreeProps", "TwoXml", "NoId"]) {
      const operation = single({
        operationId: "x",
        tags: ["X"],
        responses: { "200": json(ref("schemas", schema)) },
      })
      expect(operation).not.toHaveProperty("unwrap")
    }
    const inline = single({
      operationId: "x",
      tags: ["X"],
      responses: { "200": json({ properties: { id: {}, dmnXml: {} } }) },
    })
    expect(inline.unwrap).toBe("dmnXml")
  })

  it("fails without operationId or tag", () => {
    expect(() => single({ tags: ["X"] })).toThrow(
      new Error("GET /thing needs an operationId and a tag"),
    )
    expect(() => single({ operationId: "x", tags: [] }, "/a", "post")).toThrow(
      new Error("POST /a needs an operationId and a tag"),
    )
  })

  it("fails for unsupported request body content types", () => {
    const operation = {
      operationId: "textBody",
      tags: ["X"],
      requestBody: { content: { "text/plain": { schema: { type: "string" } } } },
    }
    expect(() => single(operation, "/x", "post")).toThrow(
      new Error("textBody: unsupported request body content types"),
    )
  })

  it("fails for unresolvable references", () => {
    const operation = { operationId: "x", tags: ["X"], parameters: [ref("parameters", "Missing")] }
    expect(() => single(operation)).toThrow(
      new Error("Unresolvable $ref: #/components/parameters/Missing"),
    )
  })
})
