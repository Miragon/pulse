import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CORE_OPERATIONS } from "../src/operations.js"
import type { Route } from "../src/route.js"
import { CORE_ROUTES_FILE, PATCH_FILE, PATCHED_SPEC_FILE, ROUTES_FILE, SPEC_FILE } from "./files.js"
import { patchedSpec, renderFiles, renderRoutes } from "./render.js"

const specText = readFileSync(SPEC_FILE, "utf8")
const patchText = readFileSync(PATCH_FILE, "utf8")

const JOB: Route = {
  operationId: "getJob",
  method: "GET",
  path: "/job/{id}",
  effect: "read",
  engineScoped: true,
  accepts: ["application/json"],
}

/** The schema of the third query parameter of GET /history/variable-instance, `variableValue`. */
function variableValueSchema(document: unknown): unknown {
  type Paths = Record<string, { get: { parameters: { schema: unknown }[] } }>
  return (document as { paths: Paths }).paths["/history/variable-instance"]?.get.parameters[2]
    ?.schema
}

describe("renderFiles", () => {
  // Under turbo, `generate` rewrites both tables before every test; CI's TypeScript job then fails
  // on a table the build changed. Run directly, this test fails on a stale one.
  it("renders the committed route tables (pnpm --fail-if-no-match --filter @miragon/pulse-c7-core generate)", () => {
    const files = renderFiles(specText, patchText, CORE_OPERATIONS)
    expect(files.routes === readFileSync(ROUTES_FILE, "utf8")).toBe(true)
    expect(files.core === readFileSync(CORE_ROUTES_FILE, "utf8")).toBe(true)
  })

  it("renders the patched spec, indented, with one newline at the end", () => {
    const { spec } = renderFiles(specText, patchText, [])
    expect(JSON.parse(spec)).toEqual(patchedSpec(specText, patchText))
    expect(spec.startsWith('{\n  "')).toBe(true)
    expect(spec.endsWith("}\n")).toBe(true)
  })

  it("builds the routes from the patched spec", () => {
    const guard = [{ op: "test", path: "/paths/~1job/post/operationId", value: "queryJobs" }]
    const renamed = JSON.stringify([
      ...guard,
      { op: "replace", path: "/paths/~1job/post/operationId", value: "storeJobs" },
    ])
    const routes = JSON.parse(renderFiles(specText, renamed, []).routes) as Record<string, Route>
    expect(routes.storeJobs).toMatchObject({ method: "POST", path: "/job" })
    expect(routes.storeJobs?.effect).not.toBe("read")
    expect(routes.queryJobs).toBeUndefined()
  })

  it("fails when a patch guard no longer matches, before it writes anything", () => {
    const guard = JSON.stringify([{ op: "test", path: "/info/title", value: "Something else" }])
    expect(() => renderFiles(specText, guard, [])).toThrow(
      new Error("JSON patch test failed at /info/title"),
    )
  })

  it("fails for a core operation the spec lacks", () => {
    expect(() => renderFiles(specText, patchText, ["nope"])).toThrow(
      new Error("Routes for unknown operations: nope"),
    )
  })
})

describe("patchedSpec", () => {
  it("applies spec/patches.json to the spec", () => {
    expect(variableValueSchema(JSON.parse(specText))).toMatchObject({ type: "object" })
    expect(variableValueSchema(patchedSpec(specText, patchText))).toEqual({ type: "string" })
  })

  it("names a task's form reference both ways, as Operaton and as CIB seven and Camunda 7 do", () => {
    type Schemas = Record<string, { properties: Record<string, unknown> }>
    const { schemas } = patchedSpec(specText, patchText).components as { schemas: Schemas }
    for (const dto of ["TaskDto", "FormDto"]) {
      expect(Object.keys(schemas[dto]?.properties ?? {})).toEqual(
        expect.arrayContaining(["operatonFormRef", "camundaFormRef"]),
      )
    }
  })
})

describe("renderRoutes", () => {
  it("writes one route per line, keyed by its id, and ends with one newline", () => {
    const other = { ...JOB, operationId: "other" }
    const text = renderRoutes({ getJob: JOB, other })
    expect(text).toBe(
      `{\n "getJob": ${JSON.stringify(JOB)},\n "other": ${JSON.stringify(other)}\n}\n`,
    )
    expect(JSON.parse(text)).toEqual({ getJob: JOB, other })
  })
})

describe("files", () => {
  it("point to the spec, its patches, the patched spec and the two tables", () => {
    expect(SPEC_FILE.pathname.endsWith("/c7-core/spec/api.json")).toBe(true)
    expect(PATCH_FILE.pathname.endsWith("/c7-core/spec/patches.json")).toBe(true)
    expect(PATCHED_SPEC_FILE.pathname.endsWith("/c7-core/spec/patched/api.json")).toBe(true)
    expect(ROUTES_FILE.pathname.endsWith("/c7-core/src/generated/routes.json")).toBe(true)
    expect(CORE_ROUTES_FILE.pathname.endsWith("/c7-core/src/generated/core-routes.json")).toBe(true)
  })
})
