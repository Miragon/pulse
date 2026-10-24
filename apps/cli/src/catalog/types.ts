/**
 * Shape of the generated operation catalog (`src/generated/catalog.<engine>.json`).
 * The catalog is produced by `scripts/generate-catalog.ts` from the vendored OpenAPI spec and is the
 * single source of truth for every generated command.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

export type ParamType = "string" | "integer" | "number" | "boolean" | "object"

/** A loosely typed OpenAPI 3.0 schema object. */
export type Schema = Record<string, unknown>

/**
 * What an operation does to engine state:
 * read = no change, write = changes one resource, delete = removes one resource,
 * bulk = may change or remove many resources (batches, query based, all versions of a key).
 */
export const EFFECTS = ["read", "write", "delete", "bulk"] as const
export type Effect = (typeof EFFECTS)[number]

export interface ParamSpec {
  /** Name on the wire (query key or path placeholder). */
  readonly name: string
  readonly in: "path" | "query"
  /** CLI name: long flag without dashes for query params, argument name for path params. */
  readonly flag: string
  readonly type: ParamType
  readonly required: boolean
  readonly description: string
  readonly format?: string
  readonly enum?: readonly string[]
  /** Boolean filter that the engine only applies when true; rendered as a plain presence flag. */
  readonly trueOnly?: boolean
}

/** A top-level scalar (or scalar array) property of a JSON body, exposed as a CLI flag. */
export interface BodyFieldSpec {
  readonly name: string
  readonly flag: string
  readonly type: "string" | "integer" | "number" | "boolean" | "array"
  /** Element type for arrays. */
  readonly items?: "string" | "integer" | "number" | "boolean"
  readonly format?: string
  readonly enum?: readonly string[]
  readonly description: string
}

/** A body property holding a map of typed variables, exposed as a repeatable `name=value` flag. */
export interface VariableMapSpec {
  readonly name: string
  readonly flag: string
}

export interface JsonBodySpec {
  readonly kind: "json"
  /** Name of the component schema, if the body references one. */
  readonly schemaName?: string
  readonly schema: Schema
  readonly fields: readonly BodyFieldSpec[]
  readonly variableMaps: readonly VariableMapSpec[]
  /** True if the whole body is a single typed variable value (`--value` and `--type`). */
  readonly variableValue: boolean
}

export interface MultipartField {
  readonly name: string
  readonly flag: string
  readonly type: "string" | "boolean" | "binary"
  readonly format?: string
  readonly description: string
}

export interface MultipartBodySpec {
  readonly kind: "multipart"
  readonly schemaName?: string
  readonly fields: readonly MultipartField[]
  /** True if resources are passed as arbitrary file parts (deployment create). */
  readonly resources: boolean
}

export type BodySpec = JsonBodySpec | MultipartBodySpec

export type ResponseKind = "json" | "text" | "binary" | "none"

export interface ResponseSpec {
  readonly status: number
  readonly kind: ResponseKind
  readonly contentTypes: readonly string[]
  readonly description: string
  readonly schema?: Schema
}

export interface OperationSpec {
  readonly operationId: string
  readonly group: string
  /** Short command name inside the group, e.g. `list`. */
  readonly name: string
  /** Additional command names, always including the kebab-cased operationId if it differs. */
  readonly aliases: readonly string[]
  readonly method: HttpMethod
  readonly path: string
  readonly summary: string
  readonly description: string
  readonly deprecated: boolean
  readonly effect: Effect
  /** False for endpoints that live outside a named engine (`/engine`, `/version`). */
  readonly engineScoped: boolean
  readonly params: readonly ParamSpec[]
  readonly body?: BodySpec
  /** Success (2xx) responses. */
  readonly responses: readonly ResponseSpec[]
  /** Property of a JSON response that holds an XML document (`bpmn20Xml`, `dmnXml`). */
  readonly unwrap?: string
  /** Fixed body properties of curated shortcut commands such as `suspend` and `activate`. */
  readonly preset?: Readonly<Record<string, unknown>>
}

export interface GroupSpec {
  readonly name: string
  readonly tag: string
  readonly description: string
}

export interface Catalog {
  readonly source: { readonly title: string; readonly version: string; readonly url: string }
  readonly groups: readonly GroupSpec[]
  readonly operations: readonly OperationSpec[]
  readonly schemas: Readonly<Record<string, Schema>>
}
