import { z } from "zod"
import { LANGUAGES, PROFILE_SCHEMA_VERSION, type LanguagePref } from "./profile-constants.js"

/**
 * Connector-free: a connector persists into ITS `modules.<module>` slice, never a new
 * top-level field. `id` is the profile key; `userId` is absent on the anonymous record.
 */
export const profileRecordSchema = z.object({
  language: z
    .enum(LANGUAGES)
    .default("system")
    .describe(
      'UI + summary language; "system" follows the host locale (summaries then stay English).',
    ),
  modules: z
    .record(z.string(), z.unknown())
    .default({})
    .describe(
      "Per-module settings slices, keyed by module name (e.g. `analytics`, `camunda7`). Each " +
        "module owns its slice's schema, validates it fail-soft on read, and writes it through " +
        "its own save tool — this record only transports the slices.",
    ),
  id: z.string(),
  userId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION).default(PROFILE_SCHEMA_VERSION),
})

export type ProfileRecord = z.infer<typeof profileRecordSchema>

/**
 * Omitted fields keep their value; `modules` merge per module key, one level deep.
 * A plain type: validation happens at each module's tool boundary, not in the store.
 */
export interface ProfileRecordSaveInput {
  language?: LanguagePref
  modules?: Record<string, unknown>
}

export function defaultProfileRecord(key: string): ProfileRecord {
  const now = new Date().toISOString()
  return {
    ...profileRecordSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse({}),
    id: key,
    userId: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

function fieldOrDefault<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : schema.parse(undefined)
}

/**
 * Degrades per FIELD to the default; unknown keys stay in the stored document because
 * saves merge over the RAW document, never this projection. Missing timestamps fall back
 * to each other, then `""` (the next save stamps both).
 */
export function projectProfileRecord(doc: Record<string, unknown>, id: string): ProfileRecord {
  const whole = profileRecordSchema.safeParse(doc)
  if (whole.success) return { ...whole.data, id }
  const { shape } = profileRecordSchema
  const updatedAt = nonEmptyString(doc.updatedAt) ?? nonEmptyString(doc.createdAt) ?? ""
  return {
    language: fieldOrDefault(shape.language, doc.language),
    modules: fieldOrDefault(shape.modules, doc.modules),
    id,
    userId: fieldOrDefault(shape.userId, doc.userId),
    createdAt: nonEmptyString(doc.createdAt) ?? updatedAt,
    updatedAt,
    schemaVersion: PROFILE_SCHEMA_VERSION,
  }
}
