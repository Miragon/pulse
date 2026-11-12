import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { buildRoutes, pickRoutes } from "./build-routes.js"
import { PATCH_FILE, SPEC_FILE } from "./files.js"
import type { OpenApiDocument, Schema } from "./openapi.js"
import { patchedSpec } from "./render.js"

const json = (schema: Schema) => ({ content: { "application/json": { schema } } })
const ref = (kind: string, name: string) => ({ $ref: `#/components/${kind}/${name}` })

const REAL = patchedSpec(readFileSync(SPEC_FILE, "utf8"), readFileSync(PATCH_FILE, "utf8"))

/** The spec with more paths and components: it holds every operation a bulk rule names. */
function document(
  paths: OpenApiDocument["paths"],
  components: NonNullable<OpenApiDocument["components"]> = {},
): OpenApiDocument {
  const real = REAL.components ?? {}
  return {
    paths: { ...REAL.paths, ...paths },
    components: {
      schemas: { ...real.schemas, ...components.schemas },
      requestBodies: { ...real.requestBodies, ...components.requestBodies },
      responses: { ...real.responses, ...components.responses },
    },
  }
}

const SPEC: OpenApiDocument = document(
  {
    "/thing/{id}": {
      parameters: [],
      summary: "a thing",
      description: "",
      servers: [],
      get: {
        operationId: "getThing",
        responses: {
          "200": { content: { "application/json": {}, "application/xml": {} } },
          "404": json({}),
        },
      },
      options: { operationId: "thingOptions", responses: { "200": json({}) } },
    },
    "/thing": {
      post: {
        operationId: "createThings",
        requestBody: ref("requestBodies", "Things"),
        responses: { "204": { description: "none" }, "200": ref("responses", "Text") },
      },
      delete: {
        operationId: "deleteThings",
        responses: { "200": json(ref("schemas", "BatchDto")) },
      },
      put: { operationId: "putThing", requestBody: json({ properties: { name: {} } }) },
    },
  },
  {
    requestBodies: { Things: json({ allOf: [{ properties: { thingIds: {} } }] }) },
    responses: { Text: { content: { "text/plain": {} } } },
  },
)

describe("buildRoutes", () => {
  it("gives every operation its method, path, effect, engine scope and media types", () => {
    const routes = buildRoutes(SPEC)
    expect(routes.getThing).toEqual({
      operationId: "getThing",
      method: "GET",
      path: "/thing/{id}",
      effect: "read",
      engineScoped: true,
      accepts: ["application/json", "application/xml"],
    })
    expect(routes.thingOptions).toMatchObject({ method: "OPTIONS", effect: "read" })
    expect(routes.createThings).toMatchObject({ effect: "bulk", accepts: ["text/plain"] })
    expect(routes.deleteThings).toMatchObject({ effect: "bulk", accepts: ["application/json"] })
    expect(routes.putThing).toMatchObject({ method: "PUT", effect: "write", accepts: [] })
  })

  it("keys the routes by operation id in code unit order", () => {
    const ids = Object.keys(buildRoutes(SPEC))
    expect(ids).toEqual([...ids].sort())
    expect(ids).toContain("thingOptions")
  })

  it("scopes every path to a named engine but /engine and /version", () => {
    const routes = Object.values(buildRoutes(document({})))
    const unscoped = routes.filter((route) => !route.engineScoped).map((route) => route.path)
    expect(unscoped.sort()).toEqual(["/engine", "/version"])
  })

  it("fails for a path item key it does not know", () => {
    const spec = document({ "/x": { patch: { operationId: "patchX" } } })
    expect(() => buildRoutes(spec)).toThrow(new Error('/x: unsupported path item key "patch"'))
  })

  it("fails for an operation without an id and for an id two operations share", () => {
    expect(() => buildRoutes(document({ "/x": { get: {} } }))).toThrow(
      new Error("GET /x needs an operationId"),
    )
    const twice = document({
      "/a": { get: { operationId: "dupe" } },
      "/b": { get: { operationId: "dupe" } },
    })
    expect(() => buildRoutes(twice)).toThrow(new Error("Two operations share the operationId dupe"))
  })

  it("fails for a body or an answer whose $ref names nothing", () => {
    const body = { operationId: "x", requestBody: ref("requestBodies", "Gone") }
    expect(() => buildRoutes(document({ "/x": { post: body } }))).toThrow(
      new Error("Unresolvable $ref: #/components/requestBodies/Gone"),
    )
    const answer = { operationId: "x", responses: { "200": ref("responses", "Gone") } }
    expect(() => buildRoutes(document({ "/x": { get: answer } }))).toThrow(
      new Error("Unresolvable $ref: #/components/responses/Gone"),
    )
  })

  it("fails for a bulk rule or an override of an operation the spec lacks", () => {
    expect(() => buildRoutes({ paths: {} })).toThrow(
      /^Bulk classification for unknown operations: deleteProcessDefinitionsByKey, /,
    )
    const paths = Object.fromEntries(
      Object.entries(REAL.paths).filter(([path]) => path !== "/condition"),
    )
    expect(() => buildRoutes({ ...REAL, paths })).toThrow(
      new Error("Effect overrides for unknown operations: evaluateCondition"),
    )
  })
})

describe("pickRoutes", () => {
  const routes = buildRoutes(SPEC)

  it("picks the routes of the ids, once each, in code unit order", () => {
    const picked = pickRoutes(routes, ["putThing", "getThing", "putThing"])
    expect(Object.keys(picked)).toEqual(["getThing", "putThing"])
    expect(picked.getThing).toBe(routes.getThing)
  })

  it("fails for an id the table lacks, an inherited name included", () => {
    expect(() => pickRoutes(routes, ["nope"])).toThrow(
      new Error("Routes for unknown operations: nope"),
    )
    expect(() => pickRoutes(routes, ["constructor"])).toThrow(
      new Error("Routes for unknown operations: constructor"),
    )
  })
})
