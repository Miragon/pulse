import { describe, expect, it } from "vitest"
import type {
  BodyFieldSpec,
  Catalog,
  JsonBodySpec,
  MultipartBodySpec,
  OperationSpec,
  ParamSpec,
} from "../../src/catalog/types.js"
import { buildCatalog } from "./build-catalog.js"
import { readPatchedSpec } from "./files.js"
import {
  GLOBAL_FLAGS,
  JSON_BODY_FLAGS,
  PAGINATION_FLAGS,
  RESOURCE_FLAGS,
  VARIABLE_VALUE_FLAGS,
  assignFlags,
} from "./flags.js"
import { SPEC_URL } from "./render.js"

function query(name: string, flag: string, type: ParamSpec["type"] = "string"): ParamSpec {
  return { name, in: "query", flag, type, required: false, description: "" }
}

function field(name: string, type: BodyFieldSpec["type"] = "string"): BodyFieldSpec {
  return { name, flag: "", type, description: "" }
}

function json(names: readonly string[], extra: Partial<JsonBodySpec> = {}): JsonBodySpec {
  return {
    kind: "json",
    schema: {},
    fields: names.map((name) => field(name)),
    variableMaps: [],
    variableValue: false,
    ...extra,
  }
}

function multipart(names: readonly string[], resources: boolean): MultipartBodySpec {
  return {
    kind: "multipart",
    fields: names.map((name) => ({ name, flag: "", type: "string", description: "" })),
    resources,
  }
}

function flagsOf(body: ReturnType<typeof assignFlags>): string[] {
  return body?.fields.map((entry) => entry.flag) ?? []
}

describe("flag lists", () => {
  it("has --all as the only pagination flag", () => {
    expect(PAGINATION_FLAGS).toEqual(["all"])
  })

  it("lists the global options of the CLI", () => {
    expect(GLOBAL_FLAGS).toEqual([
      "url",
      "engine",
      "flavor",
      "profile",
      "config",
      "output",
      "fields",
      "pretty",
      "dry-run",
      "yes",
      "read-only",
      "timeout",
      "header",
      "auth",
      "auth-user",
      "auth-password-stdin",
      "auth-token-stdin",
      "verbose",
      "out-file",
      "show-secrets",
      "help",
    ])
  })

  it("lists the body related flags", () => {
    expect(JSON_BODY_FLAGS).toEqual(["body", "validate", "no-validate"])
    expect(VARIABLE_VALUE_FLAGS).toEqual(["value"])
    expect(RESOURCE_FLAGS).toEqual(["base-dir"])
  })
})

describe("assignFlags", () => {
  it("returns undefined without a body", () => {
    expect(assignFlags([], undefined)).toBeUndefined()
  })

  it("assigns kebab-case flags to body fields", () => {
    expect(flagsOf(assignFlags([], json(["businessKey", "skipIoMappings"])))).toEqual([
      "business-key",
      "skip-io-mappings",
    ])
  })

  it("uses friendlier flags for some fields", () => {
    expect(flagsOf(assignFlags([], json(["deletions"])))).toEqual(["delete-var"])
  })

  it("prefixes fields that collide with global flags", () => {
    expect(flagsOf(assignFlags([], json(["url", "output", "fields", "help"])))).toEqual([
      "body-url",
      "body-output",
      "body-fields",
      "body-help",
    ])
  })

  it("prefixes fields that collide with query parameters", () => {
    const params = [query("tenantId", "tenant-id")]
    expect(flagsOf(assignFlags(params, json(["tenantId", "name"])))).toEqual([
      "body-tenant-id",
      "name",
    ])
  })

  it("prefixes fields named like a path argument, so --id never sits next to <id>", () => {
    const params = [{ ...query("id", "id"), in: "path" as const }]
    expect(flagsOf(assignFlags(params, json(["id"])))).toEqual(["body-id"])
  })

  it("reserves --all only for paginated operations", () => {
    expect(flagsOf(assignFlags([query("maxResults", "max-results")], json(["all"])))).toEqual([
      "body-all",
    ])
    expect(flagsOf(assignFlags([query("firstResult", "first-result")], json(["all"])))).toEqual([
      "all",
    ])
    expect(flagsOf(assignFlags([query("maxResults", "max-results")], json(["limit"])))).toEqual([
      "limit",
    ])
  })

  it("reserves the JSON body, variable map and variable value flags", () => {
    const body = json(["body", "validate", "var", "value"], {
      variableMaps: [{ name: "variables", flag: "var" }],
      variableValue: true,
    })
    expect(flagsOf(assignFlags([], body))).toEqual([
      "body-body",
      "body-validate",
      "body-var",
      "body-value",
    ])
    expect(flagsOf(assignFlags([], json(["value"])))).toEqual(["value"])
  })

  it("reserves --base-dir only for resource uploads", () => {
    expect(flagsOf(assignFlags([], multipart(["baseDir", "body"], true)))).toEqual([
      "body-base-dir",
      "body",
    ])
    expect(flagsOf(assignFlags([], multipart(["baseDir"], false)))).toEqual(["base-dir"])
  })

  it("prefixes the second of two fields with the same flag", () => {
    expect(flagsOf(assignFlags([], json(["tenantId", "tenant-id"])))).toEqual([
      "tenant-id",
      "body-tenant-id",
    ])
  })

  it("fails when even the prefixed flag is taken", () => {
    expect(() => assignFlags([], json(["tenantId", "tenant-id", "TenantId"]))).toThrow(
      new Error('Cannot find a free flag for body field "TenantId"'),
    )
  })

  it("keeps every other property and does not modify its input", () => {
    const body = json(["businessKey"], {
      schemaName: "X",
      variableMaps: [{ name: "variables", flag: "var" }],
    })
    const copy = structuredClone(body)
    const result = assignFlags([], body)
    expect(body).toEqual(copy)
    expect(result).toEqual({
      ...body,
      fields: [{ ...field("businessKey"), flag: "business-key" }],
    })
  })
})

/** `--x` plus the `--no-x` negation commander registers for a negatable boolean. */
function withNegation(flag: string, negatable: boolean): string[] {
  return negatable && !flag.startsWith("no-") ? [flag, `no-${flag}`] : [flag]
}

function queryFlags(operation: OperationSpec): string[] {
  return operation.params
    .filter((param) => param.in === "query")
    .flatMap((param) =>
      withNegation(param.flag, param.type === "boolean" && param.trueOnly !== true),
    )
}

function bodyFlags(body: OperationSpec["body"]): string[] {
  if (body === undefined) return []
  const fields = body.fields.flatMap((entry) => withNegation(entry.flag, entry.type === "boolean"))
  if (body.kind === "multipart") return [...(body.resources ? RESOURCE_FLAGS : []), ...fields]
  return [
    ...JSON_BODY_FLAGS,
    ...new Set(body.variableMaps.map((map) => map.flag)),
    ...(body.variableValue ? VARIABLE_VALUE_FLAGS : []),
    ...fields,
  ]
}

/** Every long option an operation command registers, including `--no-x` negations. */
function registeredFlags(operation: OperationSpec): string[] {
  const paginated = operation.params.some((param) => param.name === "maxResults")
  return [
    ...GLOBAL_FLAGS,
    ...queryFlags(operation),
    ...(paginated ? PAGINATION_FLAGS : []),
    ...bodyFlags(operation.body),
  ]
}

let cachedCatalog: Catalog | undefined

/**
 * The catalog built from the vendored spec. Built lazily inside the first test that needs it, never
 * at load time, so mutation testing attributes the generator code to tests.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL)
  return cachedCatalog
}

describe("flags in the generated catalog", () => {
  it("has no flag collisions in any command", () => {
    const collisions = realCatalog().operations.flatMap((operation) => {
      const flags = registeredFlags(operation)
      const duplicates = flags.filter((flag, index) => flags.indexOf(flag) !== index)
      return duplicates.map((flag) => `${operation.group} ${operation.name}: --${flag}`)
    })
    expect(collisions).toEqual([])
  })

  it("only uses lower-case kebab flags", () => {
    for (const operation of realCatalog().operations) {
      const query = operation.params.filter((param) => param.in === "query")
      for (const flag of [
        ...query.map((p) => p.flag),
        ...(operation.body?.fields ?? []).map((f) => f.flag),
      ]) {
        expect(flag).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      }
    }
  })

  it("offers --all exactly for operations with maxResults", () => {
    const paginated = realCatalog().operations.filter((operation) =>
      operation.params.some((param) => param.name === "maxResults"),
    )
    expect(paginated.length).toBeGreaterThan(50)
    for (const operation of paginated) {
      expect(operation.params.find((param) => param.name === "maxResults")?.in).toBe("query")
    }
  })
})
