import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { Routes } from "../src/route.js"
import { buildRoutes } from "./build-routes.js"
import {
  BULK_OPERATIONS,
  classifyEffect,
  EFFECT_OVERRIDES,
  type EffectInput,
  isReadOnly,
} from "./effects.js"
import { PATCH_FILE, SPEC_FILE } from "./files.js"
import { patchedSpec } from "./render.js"

let cachedRoutes: Routes | undefined

/** The routes of the patched spec, built inside the first test that needs them, never at load time. */
function realRoutes(): Routes {
  cachedRoutes ??= buildRoutes(
    patchedSpec(readFileSync(SPEC_FILE, "utf8"), readFileSync(PATCH_FILE, "utf8")),
  )
  return cachedRoutes
}

function effectOf(operationId: string) {
  const route = realRoutes()[operationId]
  if (route === undefined) throw new Error(`unknown operation ${operationId}`)
  return route.effect
}

function input(overrides: Partial<EffectInput>): EffectInput {
  return {
    operationId: "doSomething",
    method: "POST",
    path: "/thing",
    bodyProperties: undefined,
    answerSchemas: [],
    ...overrides,
  }
}

describe("isReadOnly", () => {
  it.each([
    ["GET", "deleteSomething", "/x", true],
    ["OPTIONS", "availableOperations", "/user", true],
    ["POST", "queryTasks", "/task", true],
    ["POST", "postQueryGroups", "/group", true],
    ["POST", "evaluateDecisionByKey", "/decision", true],
    ["POST", "generateMigrationPlan", "/migration/generate", true],
    ["POST", "validateMigrationPlan", "/migration/validate", true],
    ["POST", "postExecuteFilterList", "/filter/{id}/list", true],
    ["POST", "checkPassword", "/identity/password-policy", true],
    ["POST", "verifyUser", "/identity/verify", true],
    ["POST", "getGroupInfo", "/identity/groups", true],
    ["POST", "somethingCount", "/thing/count", true],
    ["POST", "createThing", "/thing/create", false],
    ["POST", "myQueryTasks", "/task", false],
    ["POST", "reevaluateThing", "/thing", false],
    ["POST", "requeryTasks", "/task", false],
    ["POST", "createCount", "/thing/counter", false],
    ["PUT", "queryTasks", "/task/count", false],
    ["DELETE", "queryTasks", "/task", false],
  ] as const)("%s %s %s → %s", (method, operationId, path, expected) => {
    expect(isReadOnly({ method, operationId, path })).toBe(expected)
  })
})

describe("classifyEffect", () => {
  it("classifies by method", () => {
    expect(classifyEffect(input({ method: "GET" }))).toBe("read")
    expect(classifyEffect(input({ method: "OPTIONS" }))).toBe("read")
    expect(classifyEffect(input({ method: "POST" }))).toBe("write")
    expect(classifyEffect(input({ method: "PUT" }))).toBe("write")
    expect(classifyEffect(input({ method: "DELETE" }))).toBe("delete")
  })

  it("applies overrides before every other rule, never an inherited name", () => {
    const override = input({ operationId: "clearIncidentAnnotation", method: "DELETE" })
    expect(classifyEffect(override)).toBe("write")
    expect(classifyEffect(input({ operationId: "evaluateCondition" }))).toBe("write")
    expect(classifyEffect(input({ operationId: "constructor", method: "GET" }))).toBe("read")
  })

  it("marks listed bulk operations as bulk", () => {
    expect(classifyEffect(input({ operationId: "cleanupAsync" }))).toBe("bulk")
    const byKey = input({ operationId: "deleteProcessDefinitionsByKey", method: "DELETE" })
    expect(classifyEffect(byKey)).toBe("bulk")
  })

  it("marks operations returning a batch as bulk", () => {
    expect(classifyEffect(input({ answerSchemas: ["BatchDto"] }))).toBe("bulk")
    expect(classifyEffect(input({ answerSchemas: ["Other"] }))).toBe("write")
  })

  it("marks bodies selecting many resources by ids or query as bulk", () => {
    expect(classifyEffect(input({ bodyProperties: ["processInstanceIds"] }))).toBe("bulk")
    const query = input({ bodyProperties: ["processInstanceQuery"], method: "DELETE" })
    expect(classifyEffect(query)).toBe("bulk")
    expect(classifyEffect(input({ bodyProperties: ["name"] }))).toBe("write")
    const lookalikes = ["processInstanceQueryTimeout", "IdsHint"]
    expect(classifyEffect(input({ bodyProperties: lookalikes }))).toBe("write")
    const mixed = input({ bodyProperties: ["skipCustomListeners", "processInstanceIds"] })
    expect(classifyEffect(mixed)).toBe("bulk")
  })

  it("does not treat selector bodies of single-resource paths as bulk", () => {
    const single = input({ bodyProperties: ["processInstanceIds"], path: "/thing/{id}" })
    expect(classifyEffect(single)).toBe("write")
  })
})

describe("effects in the route table", () => {
  it("classifies every GET and OPTIONS operation as read", () => {
    const reading = Object.values(realRoutes()).filter(
      (route) => route.method === "GET" || route.method === "OPTIONS",
    )
    expect(reading).toHaveLength(208)
    expect(reading.filter((route) => route.effect !== "read")).toEqual([])
  })

  it.each([...BULK_OPERATIONS])(
    "classifies the listed bulk operation %s as bulk",
    (operationId) => {
      expect(effectOf(operationId)).toBe("bulk")
    },
  )

  it.each([...EFFECT_OVERRIDES])("applies the override %s → %s", (operationId, effect) => {
    expect(effectOf(operationId)).toBe(effect)
  })

  it.each([
    ["deleteProcessInstance", "delete"],
    ["startProcessInstanceByKey", "write"],
    ["fetchAndLock", "write"],
    ["deleteProcessInstancesAsyncOperation", "bulk"],
    ["setRetriesByProcess", "bulk"],
    ["queryProcessInstancesCount", "read"],
  ] as const)("classifies %s as %s", (operationId, effect) => {
    expect(effectOf(operationId)).toBe(effect)
  })

  it("has the expected number of operations per effect", () => {
    const counts: Record<string, number> = {}
    for (const route of Object.values(realRoutes())) {
      counts[route.effect] = (counts[route.effect] ?? 0) + 1
    }
    expect(counts).toEqual({ read: 248, write: 90, delete: 29, bulk: 32 })
  })
})
