import { z } from "zod"
import { isTimeZone } from "../data/stats-buckets.js"
import { engineDateParam } from "./shared.js"

/** A process's numbers over time: the range, its buckets and the zone whose days they follow. */
export const processStatsInput = z.object({
  processDefinitionKey: z.string().min(1),
  from: engineDateParam("Default: 14 days or 24 hours of whole buckets up to to"),
  to: engineDateParam("Default and at most: now"),
  bucket: z.enum(["day", "hour"]),
  timeZone: z
    .string()
    .refine(isTimeZone, { message: "Expected an IANA time zone, e.g. Europe/Berlin" })
    .optional()
    .describe("IANA zone of the buckets' days and hours and of a bare date; default UTC"),
})

/** A process's counts per activity: every version summed onto the latest diagram, or one. */
export const activityCountsInput = z.object({
  processDefinitionKey: z.string().min(1),
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("One version on its own diagram; default: every version on the latest"),
})
