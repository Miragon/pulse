import { z } from "zod"
import { PERIODS } from "../prometheus.js"

export const periodField = z.enum(PERIODS).default("7d").describe("Analysis time period")

export const isoDatetimeString = z.string().refine((v) => Number.isFinite(Date.parse(v)), {
  message: "Not a parseable ISO datetime (expected e.g. 2026-07-01T12:00:00Z)",
})

// The description stays one line: the module's server instructions state the semantics once.
export const engineFilterShape = {
  engine: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Engine id(s) to scope to; omitted = all configured (see server instructions)"),
}
