/** Assigns collision-free CLI flags to body fields. */

import { isPaginated } from "../../src/catalog/rules.js"
import type { BodySpec, ParamSpec } from "../../src/catalog/types.js"
import { flagName } from "./naming.js"

/**
 * Flags the CLI registers on every operation command (see src/cli/globals.ts). Kept here so the
 * generator can rename body fields that would collide; a unit test keeps both lists in sync.
 */
export const GLOBAL_FLAGS: readonly string[] = [
  "url",
  "engine",
  "platform",
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
]

/** Flags registered only for some operations. */
export const PAGINATION_FLAGS: readonly string[] = ["all"]
export const JSON_BODY_FLAGS: readonly string[] = ["body", "validate", "no-validate"]
export const VARIABLE_VALUE_FLAGS: readonly string[] = ["value"]
export const RESOURCE_FLAGS: readonly string[] = ["base-dir"]

/** Friendlier flags for some body fields. */
const FIELD_FLAG_OVERRIDES: Readonly<Record<string, string>> = { deletions: "delete-var" }

function reservedFlags(params: readonly ParamSpec[], body: BodySpec): Set<string> {
  const paginated = isPaginated({ params })
  return new Set([
    ...GLOBAL_FLAGS,
    ...params.map((param) => param.flag),
    ...(paginated ? PAGINATION_FLAGS : []),
    ...(body.kind === "json"
      ? [
          ...JSON_BODY_FLAGS,
          ...body.variableMaps.map((map) => map.flag),
          ...(body.variableValue ? VARIABLE_VALUE_FLAGS : []),
        ]
      : body.resources
        ? RESOURCE_FLAGS
        : []),
  ])
}

function uniqueFlag(name: string, reserved: Set<string>): string {
  const preferred = FIELD_FLAG_OVERRIDES[name] ?? flagName(name)
  const flag = reserved.has(preferred) ? `body-${preferred}` : preferred
  if (reserved.has(flag)) throw new Error(`Cannot find a free flag for body field "${name}"`)
  reserved.add(flag)
  return flag
}

export function assignFlags(
  params: readonly ParamSpec[],
  body: BodySpec | undefined,
): BodySpec | undefined {
  if (body === undefined) return undefined
  const reserved = reservedFlags(params, body)
  if (body.kind === "json") {
    return {
      ...body,
      fields: body.fields.map((field) => ({ ...field, flag: uniqueFlag(field.name, reserved) })),
    }
  }
  return {
    ...body,
    fields: body.fields.map((field) => ({ ...field, flag: uniqueFlag(field.name, reserved) })),
  }
}
