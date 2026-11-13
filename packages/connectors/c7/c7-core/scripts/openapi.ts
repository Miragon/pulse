/** The parts of an OpenAPI 3.0 document the route table reads, and the lookups it needs. */

export interface Reference {
  readonly $ref: string
}

export type Schema = Readonly<Record<string, unknown>>

interface MediaType {
  readonly schema?: Schema
}

/** A request body or an answer: its schema per media type. */
export interface Content {
  readonly content?: Readonly<Record<string, MediaType>>
}

export interface Operation {
  readonly operationId?: string
  readonly requestBody?: Content | Reference
  readonly responses?: Readonly<Record<string, Content | Reference>>
}

export interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly components?: {
    readonly schemas?: Readonly<Record<string, Schema>>
    readonly requestBodies?: Readonly<Record<string, Content>>
    readonly responses?: Readonly<Record<string, Content>>
  }
}

const MAX_REF_DEPTH = 32

export function isReference(value: unknown): value is Reference {
  return (
    typeof value === "object" && value !== null && typeof (value as Reference).$ref === "string"
  )
}

/** The name a `$ref` points to, its last segment: `#/components/schemas/BatchDto` is `BatchDto`. */
export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1)
}

/** `value`, or the component its local `$ref` names; fails on a `$ref` that names none. */
export function resolve<T>(
  value: T | Reference,
  components: Readonly<Record<string, T>> | undefined,
): T {
  if (!isReference(value)) return value
  const name = refName(value.$ref)
  const target =
    value.$ref.startsWith("#/components/") &&
    components !== undefined &&
    Object.hasOwn(components, name)
      ? components[name]
      : undefined
  if (target === undefined) throw new Error(`Unresolvable $ref: ${value.$ref}`)
  return target
}

function asSchema(value: unknown): Schema | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Schema)
    : undefined
}

type Schemas = Readonly<Record<string, Schema>> | undefined

/** Follows `$ref`s to a schema; one that names no schema reads as `{}`. */
function deref(schema: Schema, schemas: Schemas): Schema {
  let current = schema
  for (let depth = 0; depth < MAX_REF_DEPTH && isReference(current); depth += 1) {
    const name = refName(current.$ref)
    const target = schemas !== undefined && Object.hasOwn(schemas, name) ? schemas[name] : undefined
    current = target ?? {}
  }
  return current
}

/**
 * The property names of an object schema, merged across `allOf` (each schema read once, so a
 * cyclic `allOf` ends), in the order they appear.
 */
export function propertyNames(schema: Schema, schemas: Schemas): string[] {
  const names = new Set<string>()
  const seen = new Set<Schema>()
  const visit = (part: Schema): void => {
    const resolved = deref(part, schemas)
    if (seen.has(resolved)) return
    seen.add(resolved)
    const parts: unknown[] = Array.isArray(resolved.allOf) ? resolved.allOf : []
    for (const inner of parts.map(asSchema)) if (inner !== undefined) visit(inner)
    for (const [name, property] of Object.entries(asSchema(resolved.properties) ?? {})) {
      if (asSchema(property) !== undefined) names.add(name)
    }
  }
  visit(schema)
  return [...names]
}
