import { z } from "zod"
import { PERIODS } from "@miragon/pulse-analytics-client"

/** No description: the module's server instructions name the periods once. */
export const periodField = z.enum(PERIODS).default("7d")

export const isoDatetimeString = z.string().refine((v) => Number.isFinite(Date.parse(v)), {
  message: "Not a parseable ISO datetime (expected e.g. 2026-07-01T12:00:00Z)",
})

// No description: the module's server instructions state the semantics once.
export const engineFilterShape = {
  engine: z.union([z.string(), z.array(z.string())]).optional(),
}
