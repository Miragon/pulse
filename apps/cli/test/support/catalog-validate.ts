/** A validateBody shorthand for the body validation tests (src/catalog/validate*.test.ts). */

import type { Schema } from "../../src/catalog/types.js"
import { type Problem, validateBody } from "../../src/catalog/validate.js"

export function problems(
  schema: Schema,
  value: unknown,
  schemas: Record<string, Schema> = {},
): Problem[] {
  return validateBody(schema, value, schemas)
}
