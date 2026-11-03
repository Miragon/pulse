import { z } from "zod"
import { ENGINE_DATE_INPUT_FORMS, isEngineDateInput } from "@miragon/pulse-engine-core"

/**
 * Variable metadata in the engine's `valueInfo` shape. Object values need
 * `objectTypeName` (the Java type) and travel serialized in
 * `serializationDataFormat` (default application/json).
 */
export const variableValueInfo = z.record(z.string(), z.unknown()).optional()

/**
 * A variables map (`{ name: { value, type?, valueInfo? } }`). No description:
 * the shape is stated once in the engine module instructions.
 */
export const variableSchema = z.record(
  z.string(),
  z.object({
    value: z.unknown(),
    type: z.string().optional(),
    valueInfo: variableValueInfo,
  }),
)

/**
 * The optional `variableName` of the runtime variable reads. A model-facing
 * read cuts long string values (`truncated: true`); naming one variable
 * returns it whole, the read a write-back must start from, since a cut value
 * written back silently loses the rest.
 */
export const wholeVariableParam = z
  .string()
  .optional()
  .describe("Return only this variable, whole (never cut)")

/**
 * The largest page any list/query tool returns. One page is what a model
 * reads in one turn: an uncapped `maxResults` let a single call pull an
 * engine's whole history into the context. More rows are one `nextOffset`
 * call away; the envelope says so.
 */
export const MAX_PAGE_SIZE = 100

/**
 * The one paging definition, of the list tools and the widget feeds alike:
 * an offset from 0 (`firstResult`) and a page of at most
 * {@link MAX_PAGE_SIZE} rows (`maxResults`). A list returns the page
 * `[firstResult, firstResult + maxResults)` plus a total count. Each surface
 * presents it its own way, below; both forms are on the tools/list wire.
 */
const pageOffset = () => z.number().int().min(0).optional()
const pageSize = () => z.number().int().positive().max(MAX_PAGE_SIZE).optional()

/**
 * The list tools' paging offset. Pairs with `maxResults`: callers page
 * through by passing the `nextOffset` from the previous response. No
 * description: the paging contract is stated once in the engine module
 * instructions.
 */
export const firstResultParam = pageOffset().default(0)

/**
 * The list tools' `maxResults`, with a per-tool default page size. No
 * description: the paging contract is stated once in the engine module
 * instructions.
 */
export function maxResultsParam(defaultPageSize = 20) {
  return pageSize().default(defaultPageSize)
}

/**
 * The widget feeds' paging (`*_data`): described, no default (a feed's
 * builder pages by its own default when the widget sends none). Capped on
 * every feed on the wire: some hosts hand a view's `structuredContent` to
 * the model.
 */
export const pagingShape = {
  firstResult: pageOffset().describe("Offset for pagination (0-based)."),
  maxResults: pageSize().describe("Page size."),
}

/**
 * Sort direction of every list query. The engine sorts only by a sortBy +
 * sortOrder PAIR; the tools pair them (`engineSorting`), so a sortBy alone
 * sorts ascending. No description: the sort rule is stated once in the
 * engine module instructions.
 */
export const sortOrderParam = z.enum(["asc", "desc"]).optional()

/**
 * An optional `…Like` filter. The tools send it through `engineLike`, which
 * wraps a value without `%` into a substring match (the engine itself would
 * match it EXACTLY). The substring rule is stated once in the engine module
 * instructions, so the field carries no description.
 */
export function likeParam() {
  return z.string().optional()
}

/**
 * An optional boolean filter. The engine IGNORES a `false` (no filter, not a
 * negation), so the tools never forward one: a flag with a complement is
 * sent as the complement (`complementaryFlags`), any other is dropped
 * (`trueOnly`). The complementary pairs are stated once in the engine module
 * instructions; a flag gets a description only when it means more than its
 * name, e.g. `"true = only instances with an open incident"`.
 */
export function flagParam(description?: string) {
  const flag = z.boolean().optional()
  return description === undefined ? flag : flag.describe(description)
}

/**
 * An optional ISO 8601 date filter, converted to the engine's own format by
 * `toEngineDate` in the tool handler. Validated by a refinement, not a
 * pattern: the accepted forms are stated once in the engine module
 * instructions (and named by the refinement's message) instead of a regex
 * the model would have to read. A date gets a description only when it means
 * more than its name.
 */
export function engineDateParam(description?: string) {
  const date = z
    .string()
    .refine((value) => isEngineDateInput(value), { message: `Expected ${ENGINE_DATE_INPUT_FORMS}` })
    .optional()
  return description === undefined ? date : date.describe(description)
}
